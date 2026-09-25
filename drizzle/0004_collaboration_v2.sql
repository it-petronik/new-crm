CREATE TABLE `Attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`conversationId` text NOT NULL,
	`messageId` text,
	`uploaderId` text NOT NULL,
	`storageKey` text NOT NULL,
	`thumbKey` text,
	`originalName` text NOT NULL,
	`mimeType` text NOT NULL,
	`kind` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`durationMs` integer,
	`position` integer,
	`createdAt` integer NOT NULL,
	`deletedAt` integer,
	FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `Attachment_conversationId_kind_id_idx` ON `Attachment` (`conversationId`,`kind`,`id`);--> statement-breakpoint
CREATE INDEX `Attachment_messageId_idx` ON `Attachment` (`messageId`);--> statement-breakpoint
CREATE INDEX `Attachment_deletedAt_idx` ON `Attachment` (`deletedAt`);--> statement-breakpoint
CREATE TABLE `CollabPresence` (
	`userId` text PRIMARY KEY NOT NULL,
	`lastSeenAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `MessageReaction` (
	`messageId` text NOT NULL,
	`userId` text NOT NULL,
	`emoji` text NOT NULL,
	`conversationId` text NOT NULL,
	`createdAt` integer NOT NULL,
	PRIMARY KEY(`messageId`, `userId`, `emoji`),
	FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `Conversation` ADD `avatarKey` text;--> statement-breakpoint
ALTER TABLE `Conversation` ADD `avatarUpdatedAt` integer;