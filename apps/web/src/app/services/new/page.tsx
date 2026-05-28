import { Suspense } from 'react';
import { TopNav } from '@/components/nav';
import { CreateServiceForm } from './create-service-form';

export default function NewServicePage() {
  return (
    <>
      <TopNav />
      <main className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-lg font-semibold mb-1">New service</h1>
        <p className="text-sm text-(--color-muted) mb-6">
          Pick a template if you have one, otherwise just give us an image reference + a domain.
        </p>
        {/* useSearchParams() in the form requires request context — wrapping in
            Suspense opts the subtree out of static prerender so Next 15 doesn't
            try to evaluate searchParams at build time. */}
        <Suspense fallback={null}>
          <CreateServiceForm />
        </Suspense>
      </main>
    </>
  );
}
