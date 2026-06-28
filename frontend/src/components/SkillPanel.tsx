export function SkillPanel({ name }: { name: string }) {
  return (
    <iframe
      title={`skill-${name}`}
      src={`/skills/${encodeURIComponent(name)}/ui/`}
      style={{ width: "100%", height: "100%", border: "none", background: "white" }}
    />
  );
}
