CREATE TABLE `MeetingAttendance` (
	`meetingId` text NOT NULL,
	`userId` text NOT NULL,
	`joinedAt` integer NOT NULL,
	`leftAt` integer,
	PRIMARY KEY(`meetingId`, `userId`),
	FOREIGN KEY (`meetingId`) REFERENCES `Meeting`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `MeetingAttendance_userId_leftAt_idx` ON `MeetingAttendance` (`userId`,`leftAt`);--> statement-breakpoint
CREATE TABLE `Meeting` (
	`id` text PRIMARY KEY NOT NULL,
	`conversationId` text NOT NULL,
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
	FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `Meeting_conversationId_createdAt_idx` ON `Meeting` (`conversationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `Meeting_status_scheduledAt_idx` ON `Meeting` (`status`,`scheduledAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `Meeting_providerRoom_key` ON `Meeting` (`providerRoom`);--> statement-breakpoint
CREATE UNIQUE INDEX `Meeting_one_live_per_conversation` ON `Meeting` (`conversationId`) WHERE "status" = 'live';