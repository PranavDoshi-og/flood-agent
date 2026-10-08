"""Storage interface and implementations for Flood Agent citizen reports.

Allows seamless switching between local SQLite (default for development)
and AWS DynamoDB (for cloud deployment) without changing endpoint code.
"""
from abc import ABC, abstractmethod
from datetime import datetime, timezone
import math
import os
from pathlib import Path
import sqlite3
import sys
import uuid

backend_path = str(Path(__file__).resolve().parent)
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from models import Report, ReportCreate


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great-circle distance between two points on Earth in km."""
    r = 6371.0  # Earth radius in kilometers
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return r * c


class BaseStorage(ABC):
    """Abstract storage interface for citizen reports."""

    @abstractmethod
    def save_report(self, report_in: ReportCreate) -> Report:
        """Persist a new citizen report."""
        pass

    @abstractmethod
    def get_reports(
        self,
        lat: float | None = None,
        lon: float | None = None,
        radius_km: float = 5.0,
        limit: int = 50,
        category: str | None = None,
    ) -> list[Report]:
        """Retrieve reports, optionally filtered by distance radius and hazard category."""
        pass


class SQLiteStorage(BaseStorage):
    """Local SQLite implementation of report storage."""

    def __init__(self, db_path: str | None = None):
        if db_path is None:
            default_dir = Path(__file__).resolve().parent / "data"
            default_dir.mkdir(parents=True, exist_ok=True)
            db_path = str(default_dir / "reports.db")
        else:
            Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.db_path = db_path
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._get_connection() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS reports (
                    id TEXT PRIMARY KEY,
                    lat REAL NOT NULL,
                    lon REAL NOT NULL,
                    category TEXT NOT NULL DEFAULT 'flood_waterlogging',
                    severity TEXT NOT NULL DEFAULT 'moderate',
                    water_depth TEXT NOT NULL,
                    description TEXT NOT NULL,
                    reporter_name TEXT,
                    created_at TEXT NOT NULL
                )
                """
            )
            # Automatic schema migration for existing sqlite db instances
            try:
                conn.execute("ALTER TABLE reports ADD COLUMN category TEXT DEFAULT 'flood_waterlogging'")
            except sqlite3.OperationalError:
                pass
            try:
                conn.execute("ALTER TABLE reports ADD COLUMN severity TEXT DEFAULT 'moderate'")
            except sqlite3.OperationalError:
                pass

            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports (created_at DESC)"
            )
            conn.commit()

    def save_report(self, report_in: ReportCreate) -> Report:
        # Normalize category and severity
        category = report_in.category or "flood_waterlogging"
        severity = report_in.severity or report_in.water_depth or "moderate"
        water_depth = report_in.water_depth or severity

        report = Report(
            id=str(uuid.uuid4()),
            lat=report_in.lat,
            lon=report_in.lon,
            category=category,
            severity=severity,
            water_depth=water_depth,
            description=report_in.description,
            reporter_name=report_in.reporter_name or "Anonymous Citizen",
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO reports (id, lat, lon, category, severity, water_depth, description, reporter_name, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    report.id,
                    report.lat,
                    report.lon,
                    report.category,
                    report.severity,
                    report.water_depth,
                    report.description,
                    report.reporter_name,
                    report.created_at,
                ),
            )
            conn.commit()
        return report

    def get_reports(
        self,
        lat: float | None = None,
        lon: float | None = None,
        radius_km: float = 5.0,
        limit: int = 50,
        category: str | None = None,
    ) -> list[Report]:
        with self._get_connection() as conn:
            query = "SELECT * FROM reports"
            params = []
            if category:
                query += " WHERE category = ?"
                params.append(category)
            query += " ORDER BY created_at DESC"
            rows = conn.execute(query, params).fetchall()

        results: list[Report] = []
        for row in rows:
            keys = row.keys()
            rep = Report(
                id=row["id"],
                lat=row["lat"],
                lon=row["lon"],
                category=row["category"] if "category" in keys else "flood_waterlogging",
                severity=row["severity"] if "severity" in keys else row["water_depth"],
                water_depth=row["water_depth"],
                description=row["description"],
                reporter_name=row["reporter_name"],
                created_at=row["created_at"],
            )
            if lat is not None and lon is not None:
                dist = haversine_km(lat, lon, rep.lat, rep.lon)
                if dist <= radius_km:
                    results.append(rep)
            else:
                results.append(rep)

            if len(results) >= limit:
                break

        return results


class DynamoDBStorage(BaseStorage):
    """AWS DynamoDB storage implementation for production deployment."""

    def __init__(
        self,
        table_name: str | None = None,
        region_name: str = "us-east-1",
    ):
        self.table_name = table_name or os.environ.get("DYNAMODB_TABLE_NAME", "flood-agent-reports")
        self.region_name = region_name or os.environ.get("AWS_REGION", "us-east-1")
        self._table = None

    def _get_table(self):
        if self._table is None:
            import boto3
            dynamodb = boto3.resource("dynamodb", region_name=self.region_name)
            self._table = dynamodb.Table(self.table_name)
        return self._table

    def save_report(self, report_in: ReportCreate) -> Report:
        category = report_in.category or "flood_waterlogging"
        severity = report_in.severity or report_in.water_depth or "moderate"
        water_depth = report_in.water_depth or severity

        report = Report(
            id=str(uuid.uuid4()),
            lat=report_in.lat,
            lon=report_in.lon,
            category=category,
            severity=severity,
            water_depth=water_depth,
            description=report_in.description,
            reporter_name=report_in.reporter_name or "Anonymous Citizen",
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        table = self._get_table()
        table.put_item(Item=report.model_dump())
        return report

    def get_reports(
        self,
        lat: float | None = None,
        lon: float | None = None,
        radius_km: float = 5.0,
        limit: int = 50,
        category: str | None = None,
    ) -> list[Report]:
        table = self._get_table()
        # Scan recent items and apply geospatial and category filters
        response = table.scan(Limit=limit * 2)
        items = response.get("Items", [])
        results: list[Report] = []
        for item in items:
            rep = Report(**item)
            if category and rep.category != category:
                continue
            if lat is not None and lon is not None:
                dist = haversine_km(lat, lon, rep.lat, rep.lon)
                if dist <= radius_km:
                    results.append(rep)
            else:
                results.append(rep)
            if len(results) >= limit:
                break
        return results


_storage_instance: BaseStorage | None = None


def get_storage() -> BaseStorage:
    """Factory function returning the configured storage backend (defaults to SQLite)."""
    global _storage_instance
    if _storage_instance is None:
        backend_type = os.environ.get("STORAGE_BACKEND", "sqlite").lower()
        if backend_type == "dynamodb":
            _storage_instance = DynamoDBStorage()
        else:
            db_path = os.environ.get("DATABASE_PATH")
            _storage_instance = SQLiteStorage(db_path=db_path)
    return _storage_instance
