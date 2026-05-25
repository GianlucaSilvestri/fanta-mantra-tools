import enum

from sqlalchemy import Integer, Text
from sqlalchemy.dialects.postgresql import ARRAY, ENUM
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class MantraRole(str, enum.Enum):
    Por = "Por"
    Dc = "Dc"
    Dd = "Dd"
    Ds = "Ds"
    B = "B"
    E = "E"
    M = "M"
    C = "C"
    W = "W"
    T = "T"
    A = "A"
    Pc = "Pc"


mantra_role_enum = ENUM(
    MantraRole,
    name="mantra_role",
    values_callable=lambda e: [m.value for m in e],
    create_type=False,
)


class Player(Base):
    __tablename__ = "players"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    team: Mapped[str] = mapped_column(Text, nullable=False)
    mantra_roles: Mapped[list[MantraRole]] = mapped_column(
        ARRAY(mantra_role_enum), nullable=False
    )
    fanta_evaluation: Mapped[int | None] = mapped_column(Integer)
    fanta_market_value: Mapped[int | None] = mapped_column(Integer)


class UserEvaluation(Base):
    __tablename__ = "user_evaluations"

    # player_id mirrors Player.id but is intentionally NOT a foreign key so
    # that the TRUNCATE players that runs on every xlsx re-import doesn't
    # cascade into here. Orphaned rows (for players gone from a later xlsx)
    # are tolerated.
    player_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    evaluation: Mapped[int | None] = mapped_column(Integer)


class UserPreferences(Base):
    """Singleton row (id=1) holding the league-wide auction configuration."""

    __tablename__ = "user_preferences"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    number_of_auctioners: Mapped[int] = mapped_column(Integer, nullable=False)
    min_team_size: Mapped[int] = mapped_column(Integer, nullable=False)
    max_team_size: Mapped[int] = mapped_column(Integer, nullable=False)
    credits_per_team: Mapped[int] = mapped_column(Integer, nullable=False)
    number_of_goalkeepers: Mapped[int] = mapped_column(Integer, nullable=False)
