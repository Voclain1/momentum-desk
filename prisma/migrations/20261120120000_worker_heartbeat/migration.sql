-- CreateTable
CREATE TABLE "workerHeartbeat" (
    "workerId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workerHeartbeat_pkey" PRIMARY KEY ("workerId")
);
