CREATE TABLE `MeetingNote` (
	`id` text PRIMARY KEY NOT NULL,
	`meetingId` text NOT NULL,
	`authorId` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`data` text,
	`createdAt` integer NOT NULL,
	`deletedAt` integer,
	FOREIGN KEY (`meetingId`) REFERENCES `Meeting`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `MeetingNote_meetingId_createdAt_idx` ON `MeetingNote` (`meetingId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `MeetingReport` (
	`meetingId` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`fingerprint` text NOT NULL,
	`report` text NOT NULL,
	`models` text NOT NULL,
	`generatedBy` text NOT NULL,
	`generatedAt` integer NOT NULL,
	`editedSummary` text,
	`editedBy` text,
	`editedAt` integer,
	FOREIGN KEY (`meetingId`) REFERENCES `Meeting`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generatedBy`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`editedBy`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE no action
);
