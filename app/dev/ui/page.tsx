import { Button, Card, FaultStrip, Icon, Meter } from "@/lib/ui";

// Renders every shared component once so a reviewer can check DESIGN.md by eye.
export default function DevUiPage() {
  return (
    <main className="flex flex-col gap-6 p-8 max-w-3xl">
      <h1 className="text-3xl font-semibold">Component sheet</h1>
      <Card className="flex flex-col gap-4">
        <h2 className="text-xl">Buttons</h2>
        <div className="flex gap-3">
          <Button variant="filled">Primary action</Button>
          <Button>Secondary</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Card>
      <Card className="flex flex-col gap-4">
        <h2 className="text-xl">Meters</h2>
        <Meter dbfs={-18} student="A" label="Student A" />
        <Meter dbfs={-32} student="B" label="Student B" />
      </Card>
      <Card className="flex flex-col gap-4">
        <h2 className="text-xl">Fault strip</h2>
        <FaultStrip level="clear" />
        <FaultStrip level="warn" />
        <FaultStrip level="fault" />
      </Card>
      <Card className="flex items-center gap-2 text-fault">
        <Icon name="error" />
        <span>Blocking warning text on surface</span>
      </Card>
    </main>
  );
}
