CREATE TABLE `MeetingMessage` (
	`id` text PRIMARY KEY NOT NULL,
	`meetingId` text NOT NULL,
	`senderUserId` text,
	`senderGuestId` text,
	`senderName` text NOT NULL,
	`body` text NOT NULL,
	`clientKey` text NOT NULL,
	`createdAt` integer NOT NULL,
	`editedAt` integer,
	`deletedAt` integer,
	FOREIGN KEY (`meetingId`) REFERENCES `Meeting`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`senderUserId`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`senderGuestId`) REFERENCES `MeetingGuest`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "MeetingMessage_one_sender" CHECK(("senderUserId" IS NULL) <> ("senderGuestId" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `MeetingMessage_meetingId_id_idx` ON `MeetingMessage` (`meetingId`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `MeetingMessage_meetingId_clientKey_key` ON `MeetingMessage` (`meetingId`,`clientKey`);