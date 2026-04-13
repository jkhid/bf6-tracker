import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const OVERRIDE_HOURS = 6;

export async function GET() {
  const { data } = await supabase
    .from('tracking_override')
    .select('active_until')
    .eq('id', 1)
    .single();

  const activeUntil = data?.active_until ? new Date(data.active_until) : null;
  const active = activeUntil !== null && activeUntil > new Date();

  return NextResponse.json({
    active,
    activeUntil: active ? activeUntil!.toISOString() : null,
  });
}

export async function POST() {
  const activeUntil = new Date(Date.now() + OVERRIDE_HOURS * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('tracking_override')
    .upsert({ id: 1, active_until: activeUntil });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ active: true, activeUntil });
}

export async function DELETE() {
  const { error } = await supabase
    .from('tracking_override')
    .upsert({ id: 1, active_until: null });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ active: false, activeUntil: null });
}
