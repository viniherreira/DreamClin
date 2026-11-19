import { notFound } from 'next/navigation';
import { getPatient } from '../../actions';
import { PatientForm } from '../../_components/patient-form';
import { PatientFormFull } from '../../_components/patient-form-full';
import { currentAccess } from '@/lib/guard';
import { pacienteAgendaEnabled } from '@/lib/feature-flags';
import { readCustomAnswers } from '@/lib/patient-fields';
import { patientFormContext } from '../../patient-extra';

export const metadata = { title: 'Editar Paciente' };

const dia = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '');

export default async function EditPatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const patient = await getPatient(id);
  if (!patient) notFound();
  const acesso = await currentAccess();
  const ctx = acesso && (await pacienteAgendaEnabled(acesso.tenantId)) ? await patientFormContext(acesso.tenantId) : null;

  const formData = {
    id: patient.id,
    name: patient.name,
    nickname: patient.nickname ?? '',
    cpf: patient.cpf,
    phone: patient.phone,
    phone2: patient.phone2,
    email: patient.email ?? '',
    birthDate: dia(patient.birthDate),
    gender: patient.gender ?? '',
    maritalStatus: patient.maritalStatus ?? '',
    profession: patient.profession ?? '',
    referredBy: patient.referredBy ?? '',
    notes: patient.notes ?? '',
    zipCode: patient.zipCode ?? '',
    street: patient.street ?? '',
    addressNumber: patient.addressNumber ?? '',
    complement: patient.complement ?? '',
    neighborhood: patient.neighborhood ?? '',
    city: patient.city ?? '',
    state: patient.state ?? '',
    lgpdConsentAt: patient.lgpdConsentAt,
    marketingConsentAt: patient.marketingConsentAt,
  };

  return (
    <div className={`p-6 lg:p-8 ${ctx ? 'max-w-4xl' : 'max-w-3xl'}`}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Editar paciente</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{patient.socialName || patient.name}</p>
      </header>
      {ctx ? (
        <PatientFormFull
          origins={ctx.origins}
          fields={ctx.fields}
          required={ctx.required}
          insurers={ctx.insurers}
          patient={{
            ...formData,
            controlNumber: patient.controlNumber,
            active: patient.active,
            socialName: patient.socialName ?? '',
            genderIdentity: patient.genderIdentity ?? '',
            foreigner: patient.foreigner,
            nationality: patient.nationality ?? '',
            foreignDoc: patient.foreignDoc,
            rg: patient.rg,
            rgIssuer: patient.rgIssuer ?? '',
            landline: patient.landline,
            landlineExt: patient.landlineExt ?? '',
            otherContacts: patient.otherContacts,
            financialResponsible: patient.financialResponsible,
            financialResponsibleText: patient.financialResponsibleText ?? '',
            insurances: patient.insurances.map((i) => ({
              id: i.id,
              insurerId: i.insurerId,
              insurerName: i.insurerName,
              planName: i.planName,
              cardNumber: i.cardNumber,
              validUntil: dia(i.validUntil),
              active: i.active,
            })),
            cns: patient.cns,
            bloodType: patient.bloodType ?? '',
            spouseName: patient.spouseName ?? '',
            motherName: patient.motherName ?? '',
            fatherName: patient.fatherName ?? '',
            legalGuardian: patient.legalGuardian ?? '',
            priority: patient.priority,
            priorityType: patient.priorityType ?? '',
            education: patient.education ?? '',
            hobby: patient.hobby ?? '',
            referredByPatient: patient.referredByPatient,
            originId: patient.originId ?? '',
            birthdayMessages: patient.birthdayMessages,
            customFields: readCustomAnswers(patient.customFields),
          }}
        />
      ) : (
        <PatientForm patient={formData} />
      )}
    </div>
  );
}
