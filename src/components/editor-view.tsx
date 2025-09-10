
"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Save } from "lucide-react";
import type { File } from "./file-explorer";

interface EditorViewProps {
  activeFile: File | null;
  code: string;
  onCodeChange: (newCode: string) => void;
  onSave: () => void;
}

export function EditorView({ activeFile, code, onCodeChange, onSave }: EditorViewProps) {
  if (!activeFile) {
    return (
      <Card className="flex-1 flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <p>Select a file to start editing</p>
        </div>
      </Card>
    )
  }
  
  return (
    <Card className="flex-1 flex flex-col h-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>{activeFile.name}</CardTitle>
          <CardDescription>Language: {activeFile.language}</CardDescription>
        </div>
        <Button onClick={onSave} size="sm">
          <Save className="mr-2 h-4 w-4" />
          Save
        </Button>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        <Textarea
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
          placeholder="Write your code here..."
          className="w-full flex-1 font-code text-base bg-white dark:bg-background"
          aria-label="Code Editor"
        />
      </CardContent>
    </Card>
  );
}
