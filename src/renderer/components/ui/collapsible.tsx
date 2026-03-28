import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";

export function Collapsible(props: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

export function CollapsibleContent({ className, ...props }: CollapsiblePrimitive.Panel.Props) {
  return <CollapsiblePrimitive.Panel className={className} data-slot="collapsible-panel" {...props} />;
}
