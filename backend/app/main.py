from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import evaluations, health, players, preferences

app = FastAPI(title="Fantacalcio Mantra")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(players.router)
app.include_router(evaluations.router)
app.include_router(preferences.router)
