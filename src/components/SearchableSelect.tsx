"use client";

import React, { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';

export interface SearchableOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  /** Valores mostrados primero en el grupo "Sugeridas". */
  suggestedValues?: string[];
  suggestedLabel?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  allowClear?: boolean;
  className?: string;
  contentClassName?: string;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  suggestedValues,
  suggestedLabel = 'Sugeridas',
  placeholder = 'Seleccionar...',
  searchPlaceholder = 'Buscar...',
  emptyText = 'Sin resultados.',
  disabled,
  allowClear,
  className,
  contentClassName,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);

  const { suggested, rest } = useMemo(() => {
    const suggestedSet = new Set(suggestedValues || []);
    const s: SearchableOption[] = [];
    const r: SearchableOption[] = [];
    options.forEach((o) => (suggestedSet.has(o.value) ? s : r).push(o));
    return { suggested: s, rest: r };
  }, [options, suggestedValues]);

  const selectedLabel = options.find((o) => o.value === value)?.label || value;

  const renderItem = (o: SearchableOption, keyPrefix: string) => (
    <CommandItem
      key={`${keyPrefix}-${o.value}`}
      value={`${o.label} ${o.value}`}
      onSelect={() => {
        onChange(o.value);
        setOpen(false);
      }}
    >
      <Check className={cn('mr-2 h-4 w-4', value === o.value ? 'opacity-100' : 'opacity-0')} />
      {o.label}
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('w-full justify-between font-normal', !value && 'text-muted-foreground', className)}
        >
          <span className="truncate">{value ? selectedLabel : placeholder}</span>
          <span className="flex items-center gap-1 shrink-0">
            {allowClear && value && !disabled && (
              <X
                className="h-3.5 w-3.5 opacity-60 hover:opacity-100"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange('');
                }}
              />
            )}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn('w-[260px] p-0', contentClassName)} align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {suggested.length > 0 && (
              <CommandGroup heading={suggestedLabel}>{suggested.map((o) => renderItem(o, 's'))}</CommandGroup>
            )}
            {rest.length > 0 && (
              <CommandGroup heading={suggested.length > 0 ? 'Todas' : undefined}>
                {rest.map((o) => renderItem(o, 'r'))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
