"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UploadCloud, Github, FileArchive, Plus, Loader2 } from "lucide-react";
import type { File } from "./file-explorer";
import { useState } from "react";
import JSZip from "jszip";
import { useToast } from "@/hooks/use-toast";
import { getFileIcon } from "@/lib/utils";

interface ImportDialogProps {
  onImport: (files: File[]) => void;
}

export function ImportDialog({ onImport }: ImportDialogProps) {
  const { toast } = useToast();
  const [zipFile, setZipFile] = useState<globalThis.File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const handleZipImport = async () => {
    if (!zipFile) {
      toast({
        variant: "destructive",
        title: "No file selected",
        description: "Please select a .zip file to import.",
      });
      return;
    }

    setIsLoading(true);
    try {
      const zip = new JSZip();
      const contents = await zip.loadAsync(zipFile);
      const newFiles: File[] = [];
      
      for (const filename in contents.files) {
        if (!contents.files[filename].dir) {
          const fileContent = await contents.files[filename].async("string");
          const language = filename.split(".").pop() || "plaintext";
          newFiles.push({
            id: filename,
            name: filename,
            language: language,
            content: fileContent,
            icon: getFileIcon(filename),
          });
        }
      }
      onImport(newFiles);
      toast({
        title: "Project Imported!",
        description: `Successfully imported ${newFiles.length} files.`,
      });
      setOpen(false);
    } catch (error) {
      console.error("Error importing zip file:", error);
      toast({
        variant: "destructive",
        title: "Import Failed",
        description: "Could not read the zip file. Please check the file and try again.",
      });
    } finally {
      setIsLoading(false);
      setZipFile(null);
    }
  };


  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> Import Project
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Import Project</DialogTitle>
          <DialogDescription>
            Add your code by uploading files, from a GitHub repository, or a ZIP
            archive.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="zip" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="github" disabled>
              <Github className="mr-2 h-4 w-4" /> GitHub
            </TabsTrigger>
            <TabsTrigger value="upload" disabled>
              <UploadCloud className="mr-2 h-4 w-4" /> Upload
            </TabsTrigger>
            <TabsTrigger value="zip">
              <FileArchive className="mr-2 h-4 w-4" /> Zip
            </TabsTrigger>
          </TabsList>
          <TabsContent value="github" className="py-4">
            <div className="space-y-2">
              <Label htmlFor="github-url">GitHub Repository URL</Label>
              <Input
                id="github-url"
                placeholder="https://github.com/user/repo"
                disabled
              />
            </div>
          </TabsContent>
          <TabsContent value="upload" className="py-4">
            <div className="space-y-2">
              <Label htmlFor="file-upload">Upload Files</Label>
              <Input id="file-upload" type="file" multiple disabled />
            </div>
          </TabsContent>
          <TabsContent value="zip" className="py-4">
            <div className="space-y-2">
              <Label htmlFor="zip-upload">Upload a .zip file</Label>
              <Input
                id="zip-upload"
                type="file"
                accept=".zip"
                onChange={(e) => setZipFile(e.target.files?.[0] || null)}
              />
            </div>
          </TabsContent>
        </Tabs>
        <Button 
          onClick={handleZipImport} 
          disabled={isLoading}
          className="w-full bg-accent hover:bg-accent/90 text-accent-foreground"
        >
          {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Import'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
