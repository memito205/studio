
"use client"

import * as React from "react"
import {
  Bar,
  BarChart as RechartsBarChart,
  type BarProps as RechartsBarProps,
} from "recharts"

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

const BarChart = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof RechartsBarChart>
>(({ className, ...props }, ref) => (
  // @ts-ignore
  <RechartsBarChart ref={ref} className={className} {...props} />
))
BarChart.displayName = "BarChart"

// We need to extend the RechartsBarProps to remove the ref type which is not compatible with our
// implementation.
type BarProps = Omit<RechartsBarProps, "ref">

const BarChartBar = React.forwardRef<React.ElementRef<typeof Bar>, BarProps>(
  ({ className, ...props }, ref) => (
    // @ts-ignore
    <Bar ref={ref} className={className} {...props} />
  )
)
BarChartBar.displayName = "BarChartBar"

export { BarChart, BarChartBar }
