
"use client";

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import * as icons from 'lucide-react';

interface SubModuleCardProps {
  iconName: keyof typeof icons;
  title: string;
  description: string;
  actionText: string;
  onAction: () => void;
  disabled?: boolean;
}

export const SubModuleCard: React.FC<SubModuleCardProps> = ({ iconName, title, description, actionText, onAction, disabled }) => {
    const IconComponent = icons[iconName] as React.ElementType;

    return (
        <Card className="flex flex-col text-center items-center transform transition-transform duration-300 hover:scale-105 hover:shadow-lg h-full">
            <CardHeader className="items-center">
                <div className="p-4 bg-primary/10 rounded-full mb-4">
                    {IconComponent ? <IconComponent className="w-8 h-8 text-primary" /> : null}
                </div>
                <CardTitle>{title}</CardTitle>
            </CardHeader>
            <CardContent className="flex-grow">
                <CardDescription>{description}</CardDescription>
            </CardContent>
            <div className="p-6 pt-0 mt-auto">
                <Button onClick={onAction} disabled={disabled} className="w-full">
                    {actionText}
                </Button>
            </div>
        </Card>
    );
};
