import * as React from "react"
import { Drawer as DrawerPrimitive } from "vaul"
import { cn } from "./utils"

export function Drawer(props) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />
}

export function DrawerTrigger(props) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />
}

export function DrawerPortal(props) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />
}

export function DrawerClose(props) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />
}

export const DrawerOverlay = React.forwardRef(function DrawerOverlay({ className, ...props }, ref) {
  return (
    <DrawerPrimitive.Overlay
      ref={ref}
      data-slot="drawer-overlay"
      className={cn("internal-drawer-overlay", className)}
      {...props}
    />
  )
})

export const DrawerContent = React.forwardRef(function DrawerContent({ className, children, ...props }, ref) {
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Content
        ref={ref}
        data-slot="drawer-content"
        className={cn("internal-drawer-content", className)}
        {...props}
      >
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  )
})

export function DrawerHeader({ className, ...props }) {
  return <div data-slot="drawer-header" className={cn("internal-drawer-header", className)} {...props} />
}

export function DrawerFooter({ className, ...props }) {
  return <div data-slot="drawer-footer" className={cn("internal-drawer-footer", className)} {...props} />
}

export const DrawerTitle = React.forwardRef(function DrawerTitle({ className, ...props }, ref) {
  return <DrawerPrimitive.Title ref={ref} data-slot="drawer-title" className={cn("internal-drawer-title", className)} {...props} />
})

export const DrawerDescription = React.forwardRef(function DrawerDescription({ className, ...props }, ref) {
  return <DrawerPrimitive.Description ref={ref} data-slot="drawer-description" className={cn("internal-drawer-description", className)} {...props} />
})
