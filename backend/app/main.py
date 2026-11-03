"""FastAPI 应用工厂：数据库初始化、CORS、错误映射、前端静态资源托管。"""

from __future__ import annotations

import logging
import os
import sqlite3
from pathlib import Path
from typing import Optional

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import auth, backup_service, db, repository
from .api import VERSION, router
from .domain import DomainError

logger = logging.getLogger("banxu")

DEFAULT_CORS = "http://localhost:5173,http://127.0.0.1:5173"
# 允许通过局域网 IP / Tailscale IP 访问；访问安全由口令登录保证
DEFAULT_HOSTS = "*"


def _cors_origins() -> list:
    raw = os.environ.get("BANXU_CORS_ORIGINS", DEFAULT_CORS)
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def create_app(db_path: Optional[str] = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        task = asyncio.create_task(backup_service.daily_backup_loop(application.state.connect))
        try:
            yield
        finally:
            task.cancel()

    app = FastAPI(
        title="班序 · 班级管理 API",
        version=VERSION,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    database = Path(db_path) if db_path else Path(os.environ.get("BANXU_DB", db.DEFAULT_DB_PATH))
    bootstrap = db.connect(database)
    try:
        db.initialize(bootstrap)
        # 旧数据/PDF 成绩单可能没有班次：启动时按分数补算，已有班次的科目不动
        with db.write_tx(bootstrap):
            repository.fill_missing_class_ranks(bootstrap)
    finally:
        bootstrap.close()

    app.state.db_path = database
    app.state.connect = lambda: db.connect(database)

    allowed_hosts = [host.strip() for host in os.environ.get("BANXU_ALLOWED_HOSTS", DEFAULT_HOSTS).split(",") if host.strip()]
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins(),
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    @app.exception_handler(DomainError)
    async def handle_domain_error(_: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(status_code=exc.status, content={"detail": exc.message, "code": exc.code})

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = exc.errors()
        first = errors[0] if errors else {}
        message = str(first.get("msg") or "参数不合法")
        return JSONResponse(
            status_code=422,
            content={"detail": errors, "code": "validation_error", "message": message},
        )

    @app.exception_handler(sqlite3.OperationalError)
    async def handle_operational_error(_: Request, exc: sqlite3.OperationalError) -> JSONResponse:
        logger.warning("sqlite operational error: %s", exc)
        if "locked" in str(exc).lower() or "busy" in str(exc).lower():
            return JSONResponse(
                status_code=503,
                content={"detail": "数据库繁忙，请稍后重试", "code": "db_busy"},
            )
        return JSONResponse(
            status_code=500,
            content={"detail": "数据库操作失败，请检查数据文件", "code": "db_error"},
        )

    @app.exception_handler(sqlite3.IntegrityError)
    async def handle_integrity_error(_: Request, exc: sqlite3.IntegrityError) -> JSONResponse:
        logger.warning("sqlite integrity error: %s", exc)
        return JSONResponse(status_code=409, content={"detail": "数据冲突，请刷新后重试", "code": "integrity_error"})

    public_paths = ("/api/login", "/api/logout", "/api/auth/status", "/api/health")

    @app.middleware("http")
    async def require_password(request: Request, call_next):
        path = request.url.path
        needs_auth = path.startswith("/api/") and not path.startswith(public_paths) and not path.startswith("/api/docs") and not path.startswith("/api/openapi")
        if needs_auth and not auth.authenticated(request):
            return JSONResponse(status_code=401, content={"detail": "需要口令登录", "code": "unauthorized"})
        return await call_next(request)

    app.include_router(router)
    logger.info("访问口令：%s（手机/其他设备打开时输入）", auth.password())

    dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    if dist.is_dir():
        app.mount("/", StaticFiles(directory=str(dist), html=True), name="frontend")
    return app


app = create_app()
