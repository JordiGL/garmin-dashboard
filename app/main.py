from fastapi import FastAPI, Depends, Request, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from sqlalchemy.orm import joinedload
from app.database import Base, engine, get_db
from app.models import Activity
from app.garmin_service import fetch_and_store_latest_activity

# Crear tablas en la BD
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Garmin Telemetry Dashboard")

app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")


@app.get("/", response_class=HTMLResponse)
def index(request: Request, db: Session = Depends(get_db)):
    activities = (
    db.query(Activity)
        .options(
            joinedload(Activity.sport_type),
            joinedload(Activity.device),
            joinedload(Activity.event_type)
        )
        .order_by(Activity.start_time_local.desc())
        .all()
    )
    
    # Pasamos `request` explícitamente y luego el contexto
    return templates.TemplateResponse(
        request=request, 
        name="index.html", 
        context={"activities": activities}
    )


@app.post("/sync")
def sync_garmin(db: Session = Depends(get_db)):
    try:
        act = fetch_and_store_latest_activity(db)
        if not act:
            return {"status": "info", "message": "No se encontraron actividades."}
        return {"status": "success", "message": f"Sincronizada: {act.name}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))