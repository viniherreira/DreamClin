import { redirect } from 'next/navigation';
import { PatientForm } from '../_components/patient-form';
import { PatientFormFull } from '../_components/patient-form-full';
import { currentAccess } from '@/lib/guard';
import { pacienteAgendaEnabled } from '@/lib/feature-flags';
import { patientFormContext } from '../patient-extra';

export const metadata = { title: 'Novo Paciente' };

export default async function NewPatientPage() {
  const acesso = await currentAccess();
  if (!acesso) redirect('/sign-in');
  const completo = await pacienteAgendaEnabled(acesso.tenantId);
  const ctx = completo ? await patientFormContext(acesso.tenantId) : null;
  return (
    <div className={`p-6 lg:p-8 ${ctx ? 'max-w-4xl' : 'max-w-3xl'}`}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Novo paciente</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {ctx ? 'Só nome, nascimento e celular são obrigatórios. O resto pode ficar para depois.' : 'Preencha os dados do paciente para cadastrá-lo'}
        </p>
      </header>
      {ctx ? <PatientFormFull origins={ctx.origins} fields={ctx.fields} required={ctx.required} insurers={ctx.insurers} /> : <PatientForm />}
    </div>
  );
}
