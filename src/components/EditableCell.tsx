
"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Input } from './ui/input';

interface EditableCellProps {
    value: string | number;
    onSave: (newValue: string) => void;
    className?: string;
}

export const EditableCell: React.FC<EditableCellProps> = ({ value, onSave, className }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [currentValue, setCurrentValue] = useState(String(value ?? ''));
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setCurrentValue(String(value ?? ''));
    }, [value]);
    
    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    const handleSave = () => {
        onSave(currentValue);
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleSave();
        } else if (e.key === 'Escape') {
            setCurrentValue(String(value ?? ''));
            setIsEditing(false);
        }
    };

    if (isEditing) {
        return (
            <Input
                ref={inputRef}
                type="text"
                value={currentValue}
                onChange={(e) => setCurrentValue(e.target.value)}
                onBlur={handleSave}
                onKeyDown={handleKeyDown}
                className="w-full h-8 p-1 border-primary bg-background"
            />
        );
    }

    return (
        <div
            onClick={() => setIsEditing(true)}
            className={`w-full min-h-[32px] p-1 cursor-pointer hover:bg-muted/50 rounded-sm ${className}`}
        >
            {currentValue}
        </div>
    );
};

    