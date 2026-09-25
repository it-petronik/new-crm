-- Migration 0007 (Meetings V3.1). Recovery: restore the pre-migration
-- backup (npm run db:backup, then scripts/restore-d1.sh) — see
-- docs/COLLABORATION-MEETINGS.md, "Migration 0007".
--
-- Meeting.conversationId becomes nullable (standalone meetings) and gains
-- guest access and an optional CRM relation. SQLite can only change a
-- column's nullability by rebuilding the table; every existing row is
-- copied column by column, unchanged (ids, provider rooms, statuses and
-- timestamps included). Dropping the old table would cascade-delete
-- MeetingAttendance (D1 enforces foreign keys), so attendance is kept aside
-- and restored, and also carried into the new MeetingSession table below.
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_Meeting` (
	`id` text PRIMARY KEY NOT NULL,
	`conversationId` text,
	`createdBy` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`media` text NOT NULL,
	`status` text NOT NULL,
	`scheduledAt` integer,
	`durationMin` integer,
	`startedAt` integer,
	`endedAt` integer,
	`providerRoom` text NOT NULL,
	`reminderSentAt` integer,
	`createdAt` integer NOT NULL,
	`guestAccess` text DEFAULT 'off' NOT NULL,
	`relatedRecordId` text,
	`relatedRecordKind` text,
	FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_Meeting`("id", "conversationId", "createdBy", "title", "kind", "media", "status", "scheduledAt", "durationMin", "startedAt", "endedAt", "providerRoom", "reminderSentAt", "createdAt", "guestAccess", "relatedRecordId", "relatedRecordKind") SELECT "id", "conversationId", "createdBy", "title", "kind", "media", "status", "scheduledAt", "durationMin", "startedAt", "endedAt", "providerRoom", "reminderSentAt", "createdAt", 'off', NULL, NULL FROM `Meeting`;--> statement-breakpoint
CREATE TABLE `__keep_MeetingAttendance` AS SELECT "meetingId", "userId", "joinedAt", "leftAt" FROM `MeetingAttendance`;--> statement-breakpoint
DROP TABLE `Meeting`;--> statement-breakpoint
ALTER TABLE `__new_Meeting` RENAME TO `Meeting`;--> statement-breakpoint
INSERT OR IGNORE INTO `MeetingAttendance`("meetingId", "userId", "joinedAt", "leftAt") SELECT "meetingId", "userId", "joinedAt", "leftAt" FROM `__keep_MeetingAttendance`;--> statement-breakpoint
DROP TABLE `__keep_MeetingAttendance`;--> statement-breakpoint
PRAGMA defer_foreign_keys = off;--> statement-breakpoint
CREATE INDEX `Meeting_conversationId_createdAt_idx` ON `Meeting` (`conversationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `Meeting_status_scheduledAt_idx` ON `Meeting` (`status`,`scheduledAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `Meeting_providerRoom_key` ON `Meeting` (`providerRoom`);--> statement-breakpoint
CREATE UNIQUE INDEX `Meeting_one_live_per_conversation` ON `Meeting` (`conversationId`) WHERE "status" = 'live';--> statement-breakpoint
CREATE INDEX `Meeting_relatedRecordId_idx` ON `Meeting` (`relatedRecordId`);--> statement-breakpoint
CREATE TABLE `MeetingActivity` (
	`id` text PRIMARY KEY NOT NULL,
	`meetingId` text NOT NULL,
	`type` text NOT NULL,
	`actorName` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`meetingId`) REFERENCES `Meeting`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `MeetingActivity_meetingId_at_idx` ON `MeetingActivity` (`meetingId`,`at`);--> statement-breakpoint
CREATE TABLE `MeetingGuestInvite` (
	`id` text PRIMARY KEY NOT NULL,
	`meetingId` text NOT NULL,
	`tokenHash` text NOT NULL,
	`createdBy` text NOT NULL,
	`createdAt` integer NOT NULL,
	`expiresAt` integer,
	`revokedAt` integer,
	FOREIGN KEY (`meetingId`) REFERENCES `Meeting`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `MeetingGuestInvite_tokenHash_key` ON `MeetingGuestInvite` (`tokenHash`);--> statement-breakpoint
CREATE INDEX `MeetingGuestInvite_meetingId_idx` ON `MeetingGuestInvite` (`meetingId`);--> statement-breakpoint
CREATE TABLE `MeetingGuest` (
	`id` text PRIMARY KEY NOT NULL,
	`meetingId` text NOT NULL,
	`inviteId` text NOT NULL,
	`name` text NOT NULL,
	`secretHash` text NOT NULL,
	`status` text NOT NULL,
	`createdAt` integer NOT NULL,
	`decidedAt` integer,
	`decidedBy` text,
	FOREIGN KEY (`meetingId`) REFERENCES `Meeting`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `MeetingGuest_secretHash_key` ON `MeetingGuest` (`secretHash`);--> statement-breakpoint
CREATE INDEX `MeetingGuest_meetingId_status_idx` ON `MeetingGuest` (`meetingId`,`status`);--> statement-breakpoint
CREATE TABLE `MeetingInvitee` (
	`meetingId` text NOT NULL,
	`userId` text NOT NULL,
	`invitedBy` text NOT NULL,
	`invitedAt` integer NOT NULL,
	PRIMARY KEY(`meetingId`, `userId`),
	FOREIGN KEY (`meetingId`) REFERENCES `Meeting`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `MeetingInvitee_userId_idx` ON `MeetingInvitee` (`userId`);--> statement-breakpoint
CREATE TABLE `MeetingRecording` (
	`id` text PRIMARY KEY NOT NULL,
	`meetingId` text NOT NULL,
	`egressId` text,
	`startedBy` text NOT NULL,
	`startedAt` integer NOT NULL,
	`stoppedAt` integer,
	`status` text NOT NULL,
	`fileKey` text,
	`durationSeconds` integer,
	`error` text,
	FOREIGN KEY (`meetingId`) REFERENCES `Meeting`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `MeetingRecording_meetingId_idx` ON `MeetingRecording` (`meetingId`);--> statement-breakpoint
CREATE UNIQUE INDEX `MeetingRecording_egressId_key` ON `MeetingRecording` (`egressId`);--> statement-breakpoint
CREATE UNIQUE INDEX `MeetingRecording_one_active` ON `MeetingRecording` (`meetingId`) WHERE "status" IN ('starting', 'recording');--> statement-breakpoint
CREATE TABLE `MeetingSession` (
	`id` text PRIMARY KEY NOT NULL,
	`meetingId` text NOT NULL,
	`participantIdentity` text NOT NULL,
	`userId` text,
	`guestName` text,
	`kind` text NOT NULL,
	`joinedAt` integer NOT NULL,
	`leftAt` integer,
	`durationSeconds` integer,
	FOREIGN KEY (`meetingId`) REFERENCES `Meeting`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `MeetingSession_meetingId_joinedAt_idx` ON `MeetingSession` (`meetingId`,`joinedAt`);--> statement-breakpoint
CREATE INDEX `MeetingSession_userId_leftAt_idx` ON `MeetingSession` (`userId`,`leftAt`);--> statement-breakpoint
CREATE INDEX `MeetingSession_identity_idx` ON `MeetingSession` (`meetingId`,`participantIdentity`,`leftAt`);--> statement-breakpoint
-- Earlier attendance becomes sessions, so past reports stay complete.
INSERT INTO `MeetingSession`("id", "meetingId", "participantIdentity", "userId", "guestName", "kind", "joinedAt", "leftAt", "durationSeconds") SELECT lower(hex(randomblob(16))), "meetingId", "userId", "userId", NULL, 'internal', "joinedAt", "leftAt", CASE WHEN "leftAt" IS NULL THEN NULL ELSE ("leftAt" - "joinedAt") / 1000 END FROM `MeetingAttendance`;
