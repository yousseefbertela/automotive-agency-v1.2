-- CreateTable
CREATE TABLE "TraceRun" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "correlation_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',

    CONSTRAINT "TraceRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraceEvent" (
    "id" TEXT NOT NULL,
    "trace_run_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "step_name" TEXT NOT NULL,
    "domain" TEXT NOT NULL DEFAULT 'general',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_ms" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'success',
    "replay_safe" BOOLEAN NOT NULL DEFAULT false,
    "input_json" JSONB,
    "output_json" JSONB,
    "error_json" JSONB,

    CONSTRAINT "TraceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TraceRun_correlation_id_key" ON "TraceRun"("correlation_id");

-- CreateIndex
CREATE INDEX "TraceRun_session_id_started_at_idx" ON "TraceRun"("session_id", "started_at");

-- CreateIndex
CREATE INDEX "TraceRun_chat_id_started_at_idx" ON "TraceRun"("chat_id", "started_at");

-- CreateIndex
CREATE INDEX "TraceRun_started_at_idx" ON "TraceRun"("started_at");

-- CreateIndex
CREATE INDEX "TraceEvent_trace_run_id_sequence_idx" ON "TraceEvent"("trace_run_id", "sequence");

-- AddForeignKey
ALTER TABLE "TraceEvent" ADD CONSTRAINT "TraceEvent_trace_run_id_fkey" FOREIGN KEY ("trace_run_id") REFERENCES "TraceRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
