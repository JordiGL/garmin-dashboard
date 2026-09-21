import io
import os
import zipfile
from datetime import datetime
from dotenv import load_dotenv
from fitparse import FitFile
from garminconnect import Garmin
from sqlalchemy.orm import Session
from app.models import (
    Activity,
    ActivityMetrics,
    ActivitySplit,
    User,
    SportType,
    EventType,
    Device,
)

load_dotenv()

TOKEN_DIR = os.path.expanduser("~/.garminconnect")
EXCLUDE_FIELDS = {"position_lat", "position_long", "timestamp"}

UNKNOWN_MAPPING = {
    # QUARQ AXS (Potencia / Dinámicas)
    "unknown_107": "quarq_status_flag",
    "unknown_108": "quarq_raw_data",
    "unknown_114": "left_torque_effectiveness",
    "unknown_115": "right_torque_effectiveness",
    # Wahoo TICKR Fit (Fisiología)
    "unknown_137": "wahoo_signal_quality",
    "unknown_138": "wahoo_status_flag",
    "unknown_144": "heart_rate_raw",
    # Garmin Varia RTL515 (Radar)
    "unknown_90": "radar_threat_level",
}


def semicircles_to_degrees(semicircles: int) -> float:
    if semicircles is None:
        return None
    return semicircles * (180 / (2**31))


def safe_parse_datetime(dt_str: str | None) -> datetime | None:
    """Convierte cadenas ISO 8601 a datetime contemplando sufijos 'Z'."""
    if not dt_str:
        return None
    try:
        return datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    except ValueError:
        return None


def get_garmin_client() -> Garmin:
    email = os.getenv("GARMIN_EMAIL")
    password = os.getenv("GARMIN_PASSWORD")

    if not email or not password:
        raise ValueError("Faltan las credenciales en el archivo .env")

    try:
        client = Garmin()
        client.login(TOKEN_DIR)
    except Exception:
        client = Garmin(email, password)
        client.login()
        client.garth.dump(TOKEN_DIR)

    return client


def fetch_and_store_latest_activity(db: Session):
    client = get_garmin_client()

    activities = client.get_activities(0, 1)
    if not activities:
        return None

    last_act = activities[0]
    garmin_id = str(last_act["activityId"])

    existing = db.query(Activity).filter(Activity.garmin_id == garmin_id).first()
    if existing:
        return existing

    # 1. Parseo del archivo FIT para la telemetría punto por punto
    zip_bytes = client.download_activity(
        garmin_id, dl_fmt=Garmin.ActivityDownloadFormat.ORIGINAL
    )

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        fit_filename = next((f for f in z.namelist() if f.endswith(".fit")), None)
        if not fit_filename:
            raise ValueError(f"El archivo ZIP descargado para la actividad {garmin_id} no contiene un archivo .fit")
        fit_bytes = z.read(fit_filename)

    telemetry_stream = []
    with io.BytesIO(fit_bytes) as fit_stream:
        fitfile = FitFile(fit_stream)

        for record in fitfile.get_messages("record"):
            point = {}
            for data in record:
                if data.value is not None:
                    if data.name == "position_lat":
                        point["lat"] = semicircles_to_degrees(data.value)
                    elif data.name == "position_long":
                        point["lng"] = semicircles_to_degrees(data.value)
                    elif data.name == "timestamp":
                        if isinstance(data.value, datetime):
                            point["timestamp"] = data.value.isoformat()
                        else:
                            point["timestamp"] = str(data.value)
                    elif data.name not in EXCLUDE_FIELDS:
                        field_name = UNKNOWN_MAPPING.get(data.name, data.name)
                        if isinstance(data.value, (int, float, str, bool)):
                            point[field_name] = data.value
                        else:
                            point[field_name] = str(data.value)

            if point.get("lat") is not None and point.get("lng") is not None:
                telemetry_stream.append(point)

    # Bloque transaccional atómico
    try:
        # 2. Gestión / Inserción en Tablas Secundarias (Relaciones)

        # Usuario
        owner_id = last_act.get("ownerId")
        user = None
        if owner_id:
            user = db.query(User).filter(User.id == owner_id).first()
            if not user:
                user = User(
                    id=owner_id,
                    display_name=last_act.get("ownerDisplayName"),
                    full_name=last_act.get("ownerFullName"),
                    image_url_small=last_act.get("ownerProfileImageUrlSmall"),
                    image_url_medium=last_act.get("ownerProfileImageUrlMedium"),
                    image_url_large=last_act.get("ownerProfileImageUrlLarge"),
                    roles=last_act.get("userRoles"),
                )
                db.add(user)

        # Tipo de deporte
        act_type = last_act.get("activityType", {})
        sport_type_id = act_type.get("typeId")
        sport_type = None
        if sport_type_id:
            sport_type = db.query(SportType).filter(SportType.id == sport_type_id).first()
            if not sport_type:
                sport_type = SportType(
                    id=sport_type_id,
                    type_key=act_type.get("typeKey"),
                    parent_type_id=act_type.get("parentTypeId"),
                    is_hidden=act_type.get("isHidden", False),
                )
                db.add(sport_type)

        # Tipo de evento
        event_data = last_act.get("eventType", {})
        event_type_id = event_data.get("typeId")
        event_type = None
        if event_type_id:
            event_type = db.query(EventType).filter(EventType.id == event_type_id).first()
            if not event_type:
                event_type = EventType(
                    id=event_type_id,
                    type_key=event_data.get("typeKey"),
                    sort_order=event_data.get("sortOrder"),
                )
                db.add(event_type)

        # Dispositivo
        device_id_str = str(last_act.get("deviceId")) if last_act.get("deviceId") else None
        device = None
        if device_id_str:
            device = db.query(Device).filter(Device.id == device_id_str).first()
            if not device:
                device = Device(
                    id=device_id_str,
                    manufacturer=last_act.get("manufacturer"),
                )
                db.add(device)

        db.flush()

        # 3. Creación de la Actividad Principal
        new_activity = Activity(
            garmin_id=garmin_id,
            activity_uuid=last_act.get("activityUUID"),
            name=last_act.get("activityName", "Entrenamiento"),
            owner_id=user.id if user else None,
            sport_type_id=sport_type.id if sport_type else None,
            event_type_id=event_type.id if event_type else None,
            device_id=device.id if device else None,
            start_time_local=safe_parse_datetime(last_act.get("startTimeLocal")),
            start_time_gmt=safe_parse_datetime(last_act.get("startTimeGMT")),
            end_time_gmt=safe_parse_datetime(last_act.get("endTimeGMT")),
            begin_timestamp=last_act.get("beginTimestamp"),
            time_zone_id=last_act.get("timeZoneId"),
            location_name=last_act.get("locationName"),
            distance_meters=last_act.get("distance"),
            duration_seconds=last_act.get("duration"),
            elapsed_duration_seconds=last_act.get("elapsedDuration"),
            moving_duration_seconds=last_act.get("movingDuration"),
            elevation_gain=last_act.get("elevationGain"),
            elevation_loss=last_act.get("elevationLoss"),
            start_latitude=last_act.get("startLatitude"),
            start_longitude=last_act.get("startLongitude"),
            end_latitude=last_act.get("endLatitude"),
            end_longitude=last_act.get("endLongitude"),
            has_polyline=last_act.get("hasPolyline", False),
            is_favorite=last_act.get("isFavorite", False),
            is_pr=last_act.get("isPR", False),
            has_images=last_act.get("hasImages", False),
            has_video=last_act.get("hasVideo", False),
            telemetry_json=telemetry_stream,
        )

        db.add(new_activity)
        db.flush()

        # 4. Inserción de Métricas Avanzadas (Relación 1:1)
        metrics = ActivityMetrics(
            activity_id=new_activity.id,
            calories=last_act.get("calories"),
            bmr_calories=last_act.get("bmrCalories"),
            calories_consumed=last_act.get("caloriesConsumed"),
            water_estimated=last_act.get("waterEstimated"),
            water_consumed=last_act.get("waterConsumed"),
            avg_hr=last_act.get("averageHR"),
            max_hr=last_act.get("maxHR"),
            avg_cadence=last_act.get("averageBikingCadenceInRevPerMinute"),
            max_cadence=last_act.get("maxBikingCadenceInRevPerMinute"),
            avg_speed=last_act.get("averageSpeed"),
            max_speed=last_act.get("maxSpeed"),
            avg_power=last_act.get("avgPower"),
            max_power=last_act.get("maxPower"),
            norm_power=last_act.get("normPower"),
            max_20min_power=last_act.get("max20MinPower"),
            training_stress_score=last_act.get("trainingStressScore"),
            intensity_factor=last_act.get("intensityFactor"),
            # Curva de potencia
            max_avg_power_1s=last_act.get("maxAvgPower_1"),
            max_avg_power_5s=last_act.get("maxAvgPower_5"),
            max_avg_power_10s=last_act.get("maxAvgPower_10"),
            max_avg_power_20s=last_act.get("maxAvgPower_20"),
            max_avg_power_30s=last_act.get("maxAvgPower_30"),
            max_avg_power_1m=last_act.get("maxAvgPower_60"),
            max_avg_power_2m=last_act.get("maxAvgPower_120"),
            max_avg_power_5m=last_act.get("maxAvgPower_300"),
            max_avg_power_10m=last_act.get("maxAvgPower_600"),
            max_avg_power_20m=last_act.get("maxAvgPower_1200"),
            max_avg_power_30m=last_act.get("maxAvgPower_1800"),
            max_avg_power_1h=last_act.get("maxAvgPower_3600"),
            # Cargas fisiológicas
            aerobic_training_effect=last_act.get("aerobicTrainingEffect"),
            anaerobic_training_effect=last_act.get("anaerobicTrainingEffect"),
            training_effect_label=last_act.get("trainingEffectLabel"),
            activity_training_load=last_act.get("activityTrainingLoad"),
            vo2_max_value=last_act.get("vO2MaxValue"),
            min_respiration_rate=last_act.get("minRespirationRate"),
            max_respiration_rate=last_act.get("maxRespirationRate"),
            avg_respiration_rate=last_act.get("avgRespirationRate"),
            min_temperature=last_act.get("minTemperature"),
            max_temperature=last_act.get("maxTemperature"),
            # Zonas
            hr_zone_1=last_act.get("hrTimeInZone_1"),
            hr_zone_2=last_act.get("hrTimeInZone_2"),
            hr_zone_3=last_act.get("hrTimeInZone_3"),
            hr_zone_4=last_act.get("hrTimeInZone_4"),
            hr_zone_5=last_act.get("hrTimeInZone_5"),
            power_zone_1=last_act.get("powerTimeInZone_1"),
            power_zone_2=last_act.get("powerTimeInZone_2"),
            power_zone_3=last_act.get("powerTimeInZone_3"),
            power_zone_4=last_act.get("powerTimeInZone_4"),
            power_zone_5=last_act.get("powerTimeInZone_5"),
            power_zone_6=last_act.get("powerTimeInZone_6"),
            power_zone_7=last_act.get("powerTimeInZone_7"),
        )
        db.add(metrics)

        # 5. Inserción de Tramos/Splits (Relación 1:N)
        for split in last_act.get("splitSummaries", []):
            act_split = ActivitySplit(
                activity_id=new_activity.id,
                split_type=split.get("splitType"),
                no_of_splits=split.get("noOfSplits"),
                duration=split.get("duration"),
                distance=split.get("distance"),
                total_ascent=split.get("totalAscent"),
                elevation_loss=split.get("elevationLoss"),
                avg_speed=split.get("averageSpeed"),
                max_speed=split.get("maxSpeed"),
            )
            db.add(act_split)

        db.commit()
        db.refresh(new_activity)
        return new_activity

    except Exception as e:
        db.rollback()
        raise RuntimeError(f"Error guardando la actividad {garmin_id} en la base de datos: {str(e)}") from e