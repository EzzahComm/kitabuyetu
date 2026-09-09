"use client";

import { Button, Input, Card, CardHeader, CardContent, CardFooter, Badge, Spinner } from "@/components/ui";

export default function ComponentsPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 py-12">
      <div className="container mx-auto px-4">
        <h1 className="text-4xl font-bold text-slate-900 dark:text-slate-50 mb-12">
          Kitabu Yetu Component Library
        </h1>

        {/* Buttons Section */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50 mb-6">
            Buttons
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader title="Primary Buttons" />
              <CardContent>
                <div className="space-y-3">
                  <Button>Default Button</Button>
                  <Button size="lg">Large Button</Button>
                  <Button size="sm">Small Button</Button>
                  <Button disabled>Disabled Button</Button>
                  <Button loading>Loading Button</Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader title="Button Variants" />
              <CardContent>
                <div className="space-y-3">
                  <Button variant="primary">Primary</Button>
                  <Button variant="secondary">Secondary</Button>
                  <Button variant="outline">Outline</Button>
                  <Button variant="ghost">Ghost</Button>
                  <Button variant="destructive">Destructive</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Input Section */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50 mb-6">
            Inputs
          </h2>
          <Card>
            <CardHeader title="Form Inputs" />
            <CardContent>
              <div className="space-y-6">
                <Input
                  label="Basic Input"
                  placeholder="Enter text"
                  helperText="This is a helper text"
                />
                <Input
                  label="Input with Error"
                  placeholder="Something wrong here"
                  error="This field is required"
                />
                <Input
                  label="Disabled Input"
                  placeholder="This is disabled"
                  disabled
                />
                <Input
                  label="Email Input"
                  type="email"
                  placeholder="user@example.com"
                />
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Cards Section */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50 mb-6">
            Cards
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card variant="default">
              <CardHeader title="Default Card" subtitle="With default styling" />
              <CardContent>
                This is a default card with subtle border and background.
              </CardContent>
              <CardFooter>
                <Button size="sm">Action</Button>
              </CardFooter>
            </Card>

            <Card variant="elevated">
              <CardHeader title="Elevated Card" subtitle="With shadow" />
              <CardContent>
                This is an elevated card with shadow for depth.
              </CardContent>
              <CardFooter>
                <Button size="sm">Action</Button>
              </CardFooter>
            </Card>

            <Card variant="outlined">
              <CardHeader title="Outlined Card" subtitle="With border" />
              <CardContent>
                This is an outlined card with emphasis on the border.
              </CardContent>
              <CardFooter>
                <Button size="sm">Action</Button>
              </CardFooter>
            </Card>
          </div>
        </section>

        {/* Badges Section */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50 mb-6">
            Badges
          </h2>
          <Card>
            <CardHeader title="Badge Variants" />
            <CardContent>
              <div className="flex flex-wrap gap-3">
                <Badge>Default</Badge>
                <Badge variant="primary">Primary</Badge>
                <Badge variant="success">Success</Badge>
                <Badge variant="warning">Warning</Badge>
                <Badge variant="error">Error</Badge>
                <Badge variant="slate">Slate</Badge>
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <Badge size="sm">Small Default</Badge>
                <Badge size="sm" variant="primary">
                  Small Primary
                </Badge>
                <Badge size="sm" variant="success">
                  Small Success
                </Badge>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Spinner Section */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50 mb-6">
            Spinners
          </h2>
          <Card>
            <CardHeader title="Loading Indicators" />
            <CardContent>
              <div className="flex flex-wrap gap-8">
                <div className="text-center">
                  <Spinner size="sm" />
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
                    Small
                  </p>
                </div>
                <div className="text-center">
                  <Spinner size="md" />
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
                    Medium
                  </p>
                </div>
                <div className="text-center">
                  <Spinner size="lg" />
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
                    Large
                  </p>
                </div>
                <div className="text-center">
                  <Spinner size="md" variant="success" />
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
                    Success
                  </p>
                </div>
                <div className="text-center">
                  <Spinner size="md" variant="error" />
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
                    Error
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Color Palette Section */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50 mb-6">
            Design Tokens
          </h2>
          <Card>
            <CardHeader title="Semantic Color Palette" />
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <div>
                  <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-50 mb-2">
                    Primary
                  </h4>
                  <div className="space-y-1">
                    <div className="w-full h-8 bg-primary-500 rounded"></div>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      #2563EB
                    </p>
                  </div>
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-50 mb-2">
                    Success
                  </h4>
                  <div className="space-y-1">
                    <div className="w-full h-8 bg-success-500 rounded"></div>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      #22C55E
                    </p>
                  </div>
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-50 mb-2">
                    Warning
                  </h4>
                  <div className="space-y-1">
                    <div className="w-full h-8 bg-warning-500 rounded"></div>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      #F59E0B
                    </p>
                  </div>
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-50 mb-2">
                    Error
                  </h4>
                  <div className="space-y-1">
                    <div className="w-full h-8 bg-error-600 rounded"></div>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      #DC2626
                    </p>
                  </div>
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-50 mb-2">
                    Slate
                  </h4>
                  <div className="space-y-1">
                    <div className="w-full h-8 bg-slate-500 rounded"></div>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      #64748B
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
