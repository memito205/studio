"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export interface File {
  id: string;
  name: string;
  language: string;
  content: string;
  icon: LucideIcon;
}

interface FileExplorerProps {
  files: File[];
  activeFile: File | null;
  onSelect: (file: File) => void;
}

export function FileExplorer({
  files,
  activeFile,
  onSelect,
}: FileExplorerProps) {
  return (
    <Card className="flex flex-col h-full">
      <CardHeader>
        <CardTitle>Project Files</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-1">
          {files.map((file) => {
            const Icon = file.icon;
            return (
              <Button
                key={file.id}
                variant="ghost"
                onClick={() => onSelect(file)}
                className={cn(
                  "w-full justify-start",
                  activeFile?.id === file.id && "bg-secondary"
                )}
              >
                <Icon className="mr-2 h-4 w-4 flex-shrink-0" />
                <span className="truncate">{file.name}</span>
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
