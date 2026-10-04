import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const STEPS = [
  {
    title: 'Register your group',
    body: 'A Changi$ha campaign is run by a registered group, not by an individual. If your group is not on Kitabu Yetu yet, register it first.',
  },
  {
    title: 'Fill the three offices',
    body: 'The group needs an active chairperson, treasurer and secretary, three different people. Add them under Members after you sign in.',
  },
  {
    title: 'Create the campaign from your dashboard',
    body: 'Go to Campaigns and choose New campaign. Kitabu Yetu reviews every campaign before it goes live.',
  },
];

export default function StartCampaignPage() {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Start a Changi$ha campaign</CardTitle>
        <CardDescription>
          Raise money for a cause, a project or someone in need, by M-Pesa and in the open. Campaigns belong to a group
          so that the money is released with several people’s sign-off.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <ol className="space-y-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span
                aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700"
              >
                {i + 1}
              </span>
              <div>
                <h3 className="text-sm font-semibold">{step.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">How money is released</p>
          <p className="mt-1">
            To withdraw what a campaign has raised, one office requests it and the other two must approve. Kitabu Yetu
            then signs off before anything is paid out.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button asChild className="flex-1">
            <Link href="/register">Register your group</Link>
          </Button>
          <Button asChild variant="outline" className="flex-1">
            <Link href="/login">Sign in to start a campaign</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
