-- CreateTable
CREATE TABLE "socio_app_accounts" (
    "socio_app_account_id" SERIAL NOT NULL,
    "socio_id" INTEGER NOT NULL,
    "email" VARCHAR(160),
    "phone" VARCHAR(20),
    "password_hash" VARCHAR(255),
    "password_enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(30) NOT NULL DEFAULT 'activa',
    "last_login_at" TIMESTAMP(3),
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "socio_app_accounts_pkey" PRIMARY KEY ("socio_app_account_id")
);

-- CreateTable
CREATE TABLE "socio_app_otps" (
    "socio_app_otp_id" SERIAL NOT NULL,
    "verification_id" VARCHAR(80) NOT NULL,
    "socio_id" INTEGER NOT NULL,
    "destination" VARCHAR(160) NOT NULL,
    "channel" VARCHAR(20) NOT NULL DEFAULT 'email',
    "code_hash" VARCHAR(255) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "socio_app_otps_pkey" PRIMARY KEY ("socio_app_otp_id")
);

-- CreateTable
CREATE TABLE "socio_app_sessions" (
    "socio_app_session_id" SERIAL NOT NULL,
    "socio_id" INTEGER NOT NULL,
    "token_id" VARCHAR(80) NOT NULL,
    "device_id" VARCHAR(120),
    "device_name" VARCHAR(120),
    "platform" VARCHAR(40),
    "app_version" VARCHAR(40),
    "ip_address" VARCHAR(80),
    "user_agent" VARCHAR(255),
    "revoked_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "socio_app_sessions_pkey" PRIMARY KEY ("socio_app_session_id")
);

-- CreateTable
CREATE TABLE "socio_app_auth_events" (
    "socio_app_auth_event_id" SERIAL NOT NULL,
    "socio_id" INTEGER,
    "event_type" VARCHAR(60) NOT NULL,
    "channel" VARCHAR(20),
    "destination" VARCHAR(160),
    "success" BOOLEAN NOT NULL,
    "reason" VARCHAR(120),
    "ip_address" VARCHAR(80),
    "user_agent" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "socio_app_auth_events_pkey" PRIMARY KEY ("socio_app_auth_event_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "socio_app_accounts_socio_id_key" ON "socio_app_accounts"("socio_id");

-- CreateIndex
CREATE INDEX "socio_app_accounts_email_idx" ON "socio_app_accounts"("email");

-- CreateIndex
CREATE INDEX "socio_app_accounts_phone_idx" ON "socio_app_accounts"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "socio_app_otps_verification_id_key" ON "socio_app_otps"("verification_id");

-- CreateIndex
CREATE INDEX "socio_app_otps_socio_id_idx" ON "socio_app_otps"("socio_id");

-- CreateIndex
CREATE INDEX "socio_app_otps_destination_idx" ON "socio_app_otps"("destination");

-- CreateIndex
CREATE INDEX "socio_app_otps_expires_at_idx" ON "socio_app_otps"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "socio_app_sessions_token_id_key" ON "socio_app_sessions"("token_id");

-- CreateIndex
CREATE INDEX "socio_app_sessions_socio_id_idx" ON "socio_app_sessions"("socio_id");

-- CreateIndex
CREATE INDEX "socio_app_sessions_expires_at_idx" ON "socio_app_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "socio_app_auth_events_socio_id_idx" ON "socio_app_auth_events"("socio_id");

-- CreateIndex
CREATE INDEX "socio_app_auth_events_event_type_idx" ON "socio_app_auth_events"("event_type");

-- CreateIndex
CREATE INDEX "socio_app_auth_events_created_at_idx" ON "socio_app_auth_events"("created_at");

-- AddForeignKey
ALTER TABLE "socio_app_accounts" ADD CONSTRAINT "socio_app_accounts_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("socio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "socio_app_otps" ADD CONSTRAINT "socio_app_otps_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("socio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "socio_app_sessions" ADD CONSTRAINT "socio_app_sessions_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("socio_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "socio_app_auth_events" ADD CONSTRAINT "socio_app_auth_events_socio_id_fkey" FOREIGN KEY ("socio_id") REFERENCES "socios"("socio_id") ON DELETE SET NULL ON UPDATE CASCADE;
