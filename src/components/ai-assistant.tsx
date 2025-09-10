"use client";

import { handleCodeConversion, handleSuggestImprovements } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Wand2, Loader2, Copy } from "lucide-react";
import { useState, useTransition } from "react";
import type { File } from "./file-explorer";

interface AiAssistantProps {
  currentFile: File | null;
  code: string;
}

function ResultDisplay({ isLoading, result, title }: { isLoading: boolean, result: string, title: string }) {
    const { toast } = useToast();
    const handleCopy = () => {
        navigator.clipboard.writeText(result);
        toast({ title: "Copied to clipboard!" });
    }

    return (
        <div className="space-y-4">
            <h3 className="text-lg font-semibold">{title}</h3>
            <Card className="h-96 relative">
              <ScrollArea className="h-full">
                <CardContent className="p-4">
                    {isLoading ? (
                        <div className="flex items-center justify-center h-full">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : (
                        <pre className="text-sm font-code whitespace-pre-wrap">{result || 'No results yet.'}</pre>
                    )}
                </CardContent>
              </ScrollArea>
              {!isLoading && result && (
                  <Button variant="ghost" size="icon" className="absolute top-2 right-2 h-7 w-7" onClick={handleCopy}>
                      <Copy className="h-4 w-4" />
                  </Button>
              )}
            </Card>
        </div>
    );
}

export function AiAssistant({ currentFile, code }: AiAssistantProps) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [improvement, setImprovement] = useState("");
  const [convertedCode, setConvertedCode] = useState("");
  const [targetLanguage, setTargetLanguage] = useState("Python");

  const onImprove = () => {
    if (!currentFile) {
        toast({ variant: "destructive", title: "No file selected", description: "Please select a file to improve." });
        return;
    }
    startTransition(async () => {
      setImprovement("");
      const result = await handleSuggestImprovements({ code, language: currentFile.language });
      if (result.error) {
        toast({ variant: "destructive", title: "Error", description: result.error });
      } else {
        setImprovement(result.data?.improvements || "No suggestions available.");
      }
    });
  };

  const onConvert = () => {
    if (!currentFile) {
        toast({ variant: "destructive", title: "No file selected", description: "Please select a file to convert." });
        return;
    }
    startTransition(async () => {
      setConvertedCode("");
      const result = await handleCodeConversion({
        code,
        sourceLanguage: currentFile.language,
        targetLanguage,
      });
      if (result.error) {
        toast({ variant: "destructive", title: "Error", description: result.error });
      } else {
        setConvertedCode(result.data?.convertedCode || "Could not convert code.");
      }
    });
  };

  return (
    <Card className="flex-1">
      <CardHeader>
        <CardTitle>AI Assistant</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="improve" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="improve">
              <Sparkles className="mr-2 h-4 w-4" /> Improve Code
            </TabsTrigger>
            <TabsTrigger value="convert">
              <Wand2 className="mr-2 h-4 w-4" /> Convert Code
            </TabsTrigger>
          </TabsList>
          <TabsContent value="improve" className="pt-4">
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Get AI-powered suggestions to improve your code's efficiency,
                readability, and quality.
              </p>
              <Button onClick={onImprove} disabled={isPending || !currentFile} className="w-full bg-accent hover:bg-accent/90 text-accent-foreground">
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Suggest Improvements
              </Button>
              <ResultDisplay isLoading={isPending} result={improvement} title="Suggestions" />
            </div>
          </TabsContent>
          <TabsContent value="convert" className="pt-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="target-lang">Target Language</Label>
                <Input
                  id="target-lang"
                  placeholder="e.g., Python, JavaScript"
                  value={targetLanguage}
                  onChange={(e) => setTargetLanguage(e.target.value)}
                />
              </div>
              <Button onClick={onConvert} disabled={isPending || !currentFile} className="w-full bg-accent hover:bg-accent/90 text-accent-foreground">
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Convert Code
              </Button>
              <ResultDisplay isLoading={isPending} result={convertedCode} title="Converted Code" />
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
