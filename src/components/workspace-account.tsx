"use client";
import { Moon, Settings2, Sparkles, Sun, UserRound } from "lucide-react";
import { Avatar } from "./avatar";
import { MoreActions } from "./ui/row-actions";
import { setTheme, useTheme } from "./theme-toggle";
import type { Actor } from "@/lib/domain";
import type { WorkspaceView } from "@/lib/workspace-experience";

/** Account utilities stay available without competing with everyday work. */
export function WorkspaceAccount({ actor, photo, onView }: { actor: Actor; photo?: string | null; onView: (view: WorkspaceView) => void }) {
  const theme = useTheme();
  return <MoreActions label="Your account" ariaLabel="Account menu" triggerClassName="profile-trigger account-menu-trigger"
    trigger={<Avatar name={actor.name} image={photo || undefined} avatarId={actor.id} size={28} />}
    actions={[
      { id:"profile", label:"My profile", icon:<UserRound size={16}/>, run:()=>onView("profile") },
      { id:"appearance", label:"Appearance", icon:<Settings2 size={16}/>, run:()=>onView("appearance") },
      { id:"theme", label:theme === "dark" ? "Switch to light mode" : "Switch to dark mode", icon:theme === "dark" ? <Sun size={16}/> : <Moon size={16}/>, run:()=>setTheme(theme === "dark" ? "light" : "dark") },
    ]}/>
}
