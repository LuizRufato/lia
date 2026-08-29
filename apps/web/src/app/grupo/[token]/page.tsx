import GroupLanding from "../group-landing";

export default async function TrackedGroupPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <GroupLanding token={token} />;
}
