import { SecondFactorForm } from "../../../src/second-factor-form.js";

export default async function SecondFactorPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { error } = await searchParams;
  return <SecondFactorForm rejected={error === "code"} />;
}
