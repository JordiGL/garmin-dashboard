from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from app.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True) # ownerId
    display_name = Column(String)          # ownerDisplayName
    full_name = Column(String)             # ownerFullName
    image_url_small = Column(String)
    image_url_medium = Column(String)
    image_url_large = Column(String)
    roles = Column(JSON)                   # userRoles

    activities = relationship("Activity", back_populates="owner")


class SportType(Base):
    __tablename__ = "sport_types"

    id = Column(Integer, primary_key=True) # typeId / sportTypeId
    type_key = Column(String)              # road_biking, running, etc.
    parent_type_id = Column(Integer, nullable=True)
    is_hidden = Column(Boolean, default=False)

    activities = relationship("Activity", back_populates="sport_type")


class EventType(Base):
    __tablename__ = "event_types"

    id = Column(Integer, primary_key=True) # typeId
    type_key = Column(String)              # uncategorized, race, etc.
    sort_order = Column(Integer, nullable=True)

    activities = relationship("Activity", back_populates="event_type")


class Device(Base):
    __tablename__ = "devices"

    id = Column(String, primary_key=True)  # deviceId
    manufacturer = Column(String)          # GARMIN

    activities = relationship("Activity", back_populates="device")


class Activity(Base):
    __tablename__ = "activities"

    id = Column(Integer, primary_key=True, index=True)
    garmin_id = Column(String, unique=True, index=True) # activityId
    activity_uuid = Column(String)                       # activityUUID
    name = Column(String)                                # activityName
    
    # Claves Foráneas (Relaciones)
    owner_id = Column(Integer, ForeignKey("users.id"))
    sport_type_id = Column(Integer, ForeignKey("sport_types.id"))
    event_type_id = Column(Integer, ForeignKey("event_types.id"), nullable=True)
    device_id = Column(String, ForeignKey("devices.id"), nullable=True)

    # Tiempos
    start_time_local = Column(DateTime)
    start_time_gmt = Column(DateTime)
    end_time_gmt = Column(DateTime)
    begin_timestamp = Column(Integer)
    time_zone_id = Column(Integer)
    location_name = Column(String)

    # Resumen Básico de Rendimiento
    distance_meters = Column(Float)
    duration_seconds = Column(Float)
    elapsed_duration_seconds = Column(Float)
    moving_duration_seconds = Column(Float)
    elevation_gain = Column(Float)
    elevation_loss = Column(Float)

    # Ubicación GPS
    start_latitude = Column(Float)
    start_longitude = Column(Float)
    end_latitude = Column(Float)
    end_longitude = Column(Float)
    has_polyline = Column(Boolean, default=False)

    # Flags
    is_favorite = Column(Boolean, default=False)
    is_pr = Column(Boolean, default=False)
    has_images = Column(Boolean, default=False)
    has_video = Column(Boolean, default=False)

    # Telemetría en bruto / Puntos GPS (Opcional)
    telemetry_json = Column(JSON, nullable=True)

    # ORM Relationships
    owner = relationship("User", back_populates="activities")
    sport_type = relationship("SportType", back_populates="activities")
    event_type = relationship("EventType", back_populates="activities")
    device = relationship("Device", back_populates="activities")
    
    metrics = relationship("ActivityMetrics", back_populates="activity", uselist=False, cascade="all, delete-orphan")
    splits = relationship("ActivitySplit", back_populates="activity", cascade="all, delete-orphan")


class ActivityMetrics(Base):
    __tablename__ = "activity_metrics"

    id = Column(Integer, primary_key=True)
    activity_id = Column(Integer, ForeignKey("activities.id"), unique=True)

    # Fisiología y Trabajo
    calories = Column(Float)
    bmr_calories = Column(Float)
    calories_consumed = Column(Float)
    water_estimated = Column(Float)
    water_consumed = Column(Float)
    avg_hr = Column(Float)
    max_hr = Column(Float)
    avg_cadence = Column(Float)
    max_cadence = Column(Float)
    avg_speed = Column(Float)
    max_speed = Column(Float)

    # Potencia y Cargas
    avg_power = Column(Float)
    max_power = Column(Float)
    norm_power = Column(Float)
    max_20min_power = Column(Float)
    training_stress_score = Column(Float)
    intensity_factor = Column(Float)
    
    # Curva de Potencia Máxima (Sprints vs Fondo)
    max_avg_power_1s = Column(Float)
    max_avg_power_5s = Column(Float)
    max_avg_power_10s = Column(Float)
    max_avg_power_20s = Column(Float)
    max_avg_power_30s = Column(Float)
    max_avg_power_1m = Column(Float)
    max_avg_power_2m = Column(Float)
    max_avg_power_5m = Column(Float)
    max_avg_power_10m = Column(Float)
    max_avg_power_20m = Column(Float)
    max_avg_power_30m = Column(Float)
    max_avg_power_1h = Column(Float)

    # Cargas de Entrenamiento Fisiológicas
    aerobic_training_effect = Column(Float)
    anaerobic_training_effect = Column(Float)
    training_effect_label = Column(String)
    activity_training_load = Column(Float)
    vo2_max_value = Column(Float)
    
    # Respiración y Temperatura
    min_respiration_rate = Column(Float)
    max_respiration_rate = Column(Float)
    avg_respiration_rate = Column(Float)
    min_temperature = Column(Float)
    max_temperature = Column(Float)

    # Zonas de Frecuencia Cardíaca (Segundos)
    hr_zone_1 = Column(Float)
    hr_zone_2 = Column(Float)
    hr_zone_3 = Column(Float)
    hr_zone_4 = Column(Float)
    hr_zone_5 = Column(Float)

    # Zonas de Potencia (Segundos)
    power_zone_1 = Column(Float)
    power_zone_2 = Column(Float)
    power_zone_3 = Column(Float)
    power_zone_4 = Column(Float)
    power_zone_5 = Column(Float)
    power_zone_6 = Column(Float)
    power_zone_7 = Column(Float)

    activity = relationship("Activity", back_populates="metrics")


class ActivitySplit(Base):
    __tablename__ = "activity_splits"

    id = Column(Integer, primary_key=True)
    activity_id = Column(Integer, ForeignKey("activities.id"))

    split_type = Column(String)              # ej. SURFACE_TYPE_PAVED
    no_of_splits = Column(Integer)
    duration = Column(Float)
    distance = Column(Float)
    total_ascent = Column(Float)
    elevation_loss = Column(Float)
    avg_speed = Column(Float)
    max_speed = Column(Float)

    activity = relationship("Activity", back_populates="splits")