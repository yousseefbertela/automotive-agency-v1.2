-- AlterEnum
ALTER TYPE "Channel" ADD VALUE 'FRONTEND';

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "channel" TEXT,
ADD COLUMN     "customer_name" TEXT,
ADD COLUMN     "customer_phone" TEXT,
ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "last_step" TEXT,
ADD COLUMN     "pending_action" TEXT,
ADD COLUMN     "pending_payload" JSONB;

-- CreateTable
CREATE TABLE "SessionLink" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "agent_session_id" TEXT NOT NULL,
    "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingNotification" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessionLink_tenant_id_last_seen_idx" ON "SessionLink"("tenant_id", "last_seen");

-- CreateIndex
CREATE INDEX "SessionLink_agent_session_id_idx" ON "SessionLink"("agent_session_id");

-- CreateIndex
CREATE INDEX "PendingNotification_tenant_id_delivered_created_at_idx" ON "PendingNotification"("tenant_id", "delivered", "created_at");

-- AddForeignKey
ALTER TABLE "SessionLink" ADD CONSTRAINT "SessionLink_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingNotification" ADD CONSTRAINT "PendingNotification_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
