-- CreateTable
CREATE TABLE "rateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "rateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "rateLimitBucket_windowStart_idx" ON "rateLimitBucket"("windowStart");

ALTER TABLE "rateLimitBucket"
    ADD CONSTRAINT "rateLimitBucket_key_check" CHECK ("key" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "rateLimitBucket_count_check" CHECK ("count" >= 1);
