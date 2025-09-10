
"use client"

import * as React from "react"
import {
  Line,
  LineChart as RechartsLineChart,
  type LineProps as RechartsLineProps,
} from "recharts"

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

const LineChart = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof RechartsLineChart>
>(({ className, ...props }, ref) => (
  // @ts-ignore
  <RechartsLineChart ref={ref} className={className} {...props} />
))
LineChart.displayName = "LineChart"

// We need to extend the RechartsLineProps to remove the ref type which is not compatible with our
// implementation.
type LineProps = Omit<RechartsLineProps, "ref">

const LineChartLine = React.forwardRef<
  React.ElementRef<typeof Line>,
  LineProps
>(({ className, ...props }, ref) => (
  // @ts-ignore
  <Line ref={ref} className={className} {...props} />
))
LineChartLine.displayName = "LineChartLine"

export { LineChart, LineChartLine }
