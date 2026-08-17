import type { ColumnDef } from '@tanstack/react-table';

export type Spec = {
  name: string;
  method: string;
  path: string;
  domain: string;
};

export const fakeData: Spec[] = [
  {
    name: 'listPets',
    method: 'get',
    path: '/pets',
    domain: 'petstore.swagger.io',
  },
  {
    name: 'createPets',
    method: 'post',
    path: '/pets',
    domain: 'petstore.swagger.io',
  },
  {
    name: 'showPetById',
    method: 'get',
    path: '/pets/{petId}',
    domain: 'petstore.swagger.io',
  },
];

export const columns: ColumnDef<Spec>[] = [
  {
    header: 'Name',
    accessorKey: 'name',
  },
  {
    header: 'Method',
    accessorKey: 'method',
  },
  {
    header: 'Path',
    accessorKey: 'path',
  },
];
