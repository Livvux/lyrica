"use client";
import {createContext,useContext,useMemo,type ReactNode} from "react";
import {createPrivateApi} from "@/lib/private-fetch";
const ProjectContext=createContext<ReturnType<typeof createPrivateApi>|null>(null);
export function PrivateProjectProvider({scope,children}:{scope:string;children:ReactNode}){const api=useMemo(()=>createPrivateApi(scope),[scope]);return <ProjectContext.Provider value={api}>{children}</ProjectContext.Provider>;}
export function usePrivateApi(){const api=useContext(ProjectContext);if(!api)throw new Error("Private project binding required");return api;}
