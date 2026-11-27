use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction, system_program,
    sysvar::Sysvar,
};

entrypoint!(process_instruction);

const VERSION: u8 = 1;
const CONFIG: &[u8] = b"registry-v1";
const RECORD: &[u8] = b"proof-v1";

pub fn process_instruction(
    program: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let mut accounts = accounts.iter();
    let authority = next_account_info(&mut accounts)?;
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let config = next_account_info(&mut accounts)?;
    let (config_address, config_bump) = Pubkey::find_program_address(&[CONFIG], program);
    if config.key != &config_address {
        return Err(ProgramError::InvalidSeeds);
    }

    match data {
        [0] => {
            let deployment_key = next_account_info(&mut accounts)?;
            let system = next_account_info(&mut accounts)?;
            if deployment_key.key != program || !deployment_key.is_signer {
                return Err(ProgramError::MissingRequiredSignature);
            }
            let mut record = vec![VERSION];
            record.extend_from_slice(authority.key.as_ref());
            write_once(
                program,
                authority,
                config,
                system,
                &[CONFIG, &[config_bump]],
                &record,
            )
        }
        [1, batch @ ..] if batch.len() == 64 => {
            let config_data = config.try_borrow_data()?;
            if config.owner != program
                || config_data.len() != 33
                || config_data[0] != VERSION
                || &config_data[1..] != authority.key.as_ref()
            {
                return Err(ProgramError::IncorrectAuthority);
            }
            let commitment = next_account_info(&mut accounts)?;
            let system = next_account_info(&mut accounts)?;
            let (address, bump) = Pubkey::find_program_address(&[RECORD, &batch[..32]], program);
            if commitment.key != &address {
                return Err(ProgramError::InvalidSeeds);
            }
            let mut record = vec![VERSION];
            record.extend_from_slice(authority.key.as_ref());
            record.extend_from_slice(batch);
            write_once(
                program,
                authority,
                commitment,
                system,
                &[RECORD, &batch[..32], &[bump]],
                &record,
            )
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn write_once<'a>(
    program: &Pubkey,
    payer: &AccountInfo<'a>,
    account: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    seeds: &[&[u8]],
    record: &[u8],
) -> ProgramResult {
    if system.key != &system_program::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    if account.owner == program {
        return if &account.try_borrow_data()?[..] == record {
            Ok(())
        } else {
            Err(ProgramError::AccountAlreadyInitialized)
        };
    }
    if account.owner != &system_program::ID || !account.data_is_empty() {
        return Err(ProgramError::IllegalOwner);
    }
    let top_up = Rent::get()?
        .minimum_balance(record.len())
        .saturating_sub(account.lamports());
    if top_up > 0 {
        solana_program::program::invoke(
            &system_instruction::transfer(payer.key, account.key, top_up),
            &[payer.clone(), account.clone(), system.clone()],
        )?;
    }
    // A PDA can be prefunded by anyone. Use allocate and assign so unsolicited
    // lamports cannot block registration.
    invoke_signed(
        &system_instruction::allocate(account.key, record.len() as u64),
        &[account.clone(), system.clone()],
        &[seeds],
    )?;
    invoke_signed(
        &system_instruction::assign(account.key, program),
        &[account.clone(), system.clone()],
        &[seeds],
    )?;
    account.try_borrow_mut_data()?.copy_from_slice(record);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn immutable_record_accepts_exact_replay_and_rejects_conflict() {
        let program = Pubkey::new_unique();
        let batch = Pubkey::new_unique();
        let authority = Pubkey::new_unique();
        let mut balance = 1;
        let mut payer_balance = 1;
        let mut system_balance = 1;
        let mut stored = [1u8; 97];
        let system = AccountInfo::new(
            &system_program::ID,
            false,
            false,
            &mut system_balance,
            &mut [],
            &system_program::ID,
            true,
            0,
        );
        let payer = AccountInfo::new(
            &authority,
            true,
            true,
            &mut payer_balance,
            &mut [],
            &system_program::ID,
            false,
            0,
        );
        let record = AccountInfo::new(
            &batch,
            false,
            true,
            &mut balance,
            &mut stored,
            &program,
            false,
            0,
        );
        assert!(write_once(&program, &payer, &record, &system, &[], &[1u8; 97]).is_ok());
        assert_eq!(
            write_once(&program, &payer, &record, &system, &[], &[2u8; 97]),
            Err(ProgramError::AccountAlreadyInitialized)
        );
    }
}
