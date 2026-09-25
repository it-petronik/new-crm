CREATE TABLE `ConversationMember` (
	`conversationId` text NOT NULL,
	`userId` text NOT NULL,
	`role` text NOT NULL,
	`joinedAt` integer NOT NULL,
	`lastReadMessageId` text,
	PRIMARY KEY(`conversationId`, `userId`),
	FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ConversationMember_userId_idx` ON `ConversationMember` (`userId`);--> statement-breakpoint
CREATE TABLE `Conversation` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text,
	`description` text,
	`visibility` text NOT NULL,
	`company` text NOT NULL,
	`branch` text,
	`directKey` text,
	`createdBy` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`lastMessageAt` integer,
	`archivedAt` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Conversation_directKey_key` ON `Conversation` (`directKey`);--> statement-breakpoint
CREATE INDEX `Conversation_company_visibility_idx` ON `Conversation` (`company`,`visibility`);--> statement-breakpoint
CREATE TABLE `MessageMention` (
	`messageId` text NOT NULL,
	`userId` text NOT NULL,
	`conversationId` text NOT NULL,
	`createdAt` integer NOT NULL,
	PRIMARY KEY(`messageId`, `userId`),
	FOREIGN KEY (`messageId`) REFERENCES `Message`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `MessageMention_userId_messageId_idx` ON `MessageMention` (`userId`,`messageId`);--> statement-breakpoint
CREATE TABLE `Message` (
	`id` text PRIMARY KEY NOT NULL,
	`conversationId` text NOT NULL,
	`authorId` text NOT NULL,
	`body` text NOT NULL,
	`replyToId` text,
	`clientKey` text,
	`createdAt` integer NOT NULL,
	`editedAt` integer,
	`deletedAt` integer,
	FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `Message_conversationId_id_idx` ON `Message` (`conversationId`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `Message_authorId_clientKey_key` ON `Message` (`authorId`,`clientKey`);