import enum
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, ENUM, TIMESTAMP
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


class AuctionStatus(str, enum.Enum):
    INITIAL = "INITIAL"
    IN_PROGRESS = "IN_PROGRESS"
    TERMINATED = "TERMINATED"


auction_status_enum = ENUM(
    AuctionStatus,
    name="auction_status",
    values_callable=lambda e: [s.value for s in e],
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
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class Auction(Base):
    __tablename__ = "auction"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[AuctionStatus] = mapped_column(
        auction_status_enum, nullable=False, server_default=AuctionStatus.INITIAL.value
    )
    number_of_auctioners: Mapped[int] = mapped_column(Integer, nullable=False)
    min_team_size: Mapped[int] = mapped_column(Integer, nullable=False)
    max_team_size: Mapped[int] = mapped_column(Integer, nullable=False)
    credits_per_team: Mapped[int] = mapped_column(Integer, nullable=False)
    number_of_goalkeepers: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (
        CheckConstraint(
            "max_team_size >= min_team_size", name="auction_team_size_range"
        ),
    )


class AuctionTeam(Base):
    __tablename__ = "auction_teams"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    auction_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("auction.id", ondelete="CASCADE"), nullable=False
    )
    team_name: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (
        UniqueConstraint("auction_id", "team_name", name="auction_teams_unique"),
    )


class AuctionPlayer(Base):
    __tablename__ = "auction_players"

    # Frozen snapshot of the relevant players columns at the moment of
    # first insertion (typically the first user evaluation, or the
    # INITIAL → IN_PROGRESS transition top-up). player_id mirrors
    # Player.id but is intentionally NOT a foreign key so that the
    # TRUNCATE players run on every xlsx re-import doesn't cascade into
    # here — once a row is in, the auction owns it.
    auction_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("auction.id", ondelete="CASCADE"),
        primary_key=True,
        autoincrement=False,
    )
    player_id: Mapped[int] = mapped_column(
        Integer, primary_key=True, autoincrement=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    team: Mapped[str] = mapped_column(Text, nullable=False)
    mantra_roles: Mapped[list[MantraRole]] = mapped_column(
        ARRAY(mantra_role_enum), nullable=False
    )
    fanta_evaluation: Mapped[int | None] = mapped_column(Integer)
    fanta_market_value: Mapped[int | None] = mapped_column(Integer)
    evaluation: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
