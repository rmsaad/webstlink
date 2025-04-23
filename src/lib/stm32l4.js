/* stm32l4.js
 * stm32l4 flash driver class
 *
 * Ported from the original Python implementation for STM32L4 and G0 programming
 *
 */

import { Exception, Warning, UsbError } from './stlinkex.js';
import { Stm32 } from './stm32.js';
import { 
  hex_word as H32,
  async_sleep
} from './util.js';

const FLASH_REG_BASE = 0x40022000;
const FLASH_KEYR_REG = FLASH_REG_BASE + 0x08;
const FLASH_OPTKEYR_REG = FLASH_REG_BASE + 0x0C;
const FLASH_SR_REG   = FLASH_REG_BASE + 0x10;
const FLASH_CR_REG   = FLASH_REG_BASE + 0x14;

const FLASH_CR_PG_BIT       = 1 << 0;
const FLASH_CR_PER_BIT      = 1 << 1;
const FLASH_CR_MER1_BIT     = 1 << 2;
const FLASH_CR_PNB_BITINDEX = 3;
const FLASH_CR_BKER_BIT     = 1 << 11;
const FLASH_CR_MER2_BIT     = 1 << 15;
const FLASH_CR_STRT_BIT     = 1 << 16;
const FLASH_CR_OPT_STRT_BIT = 1 << 17;
const FLASH_CR_FSTPG_BIT    = 1 << 18;
const FLASH_CR_OBL_LAUNCH_BIT = 1 << 27;
const FLASH_CR_OPTLOCK_BIT  = 1 << 30;
const FLASH_CR_LOCK_BIT     = 1 << 31;

const FLASH_SR_EOP_BIT    = 1 << 0;
const FLASH_SR_OPERR_BIT  = 1 << 1;
const FLASH_SR_PROGERR_BIT = 1 << 3;
const FLASH_SR_WPRERR_BIT = 1 << 4;
const FLASH_SR_PGAERR_BIT = 1 << 5;
const FLASH_SR_SIZERR_BIT = 1 << 6;
const FLASH_SR_PGSERR_BIT = 1 << 7;
const FLASH_SR_FASTERR_BIT = 1 << 8;
const FLASH_SR_MISSERR_BIT = 1 << 9;
const FLASH_SR_BUSY_BIT    = 1 << 16;
const FLASH_SR_CFGBSY_BIT  = 1 << 18;

const FLASH_SR_ERROR_MASK = FLASH_SR_PROGERR_BIT | FLASH_SR_WPRERR_BIT |
    FLASH_SR_PGAERR_BIT | FLASH_SR_SIZERR_BIT | FLASH_SR_PGSERR_BIT |
    FLASH_SR_FASTERR_BIT | FLASH_SR_MISSERR_BIT;

const FLASH_OPTR_REG       = FLASH_REG_BASE + 0x20;
const FLASH_OPTR_DBANK_BIT = 1 << 22;

class Flash {
    constructor(driver, stlink, dbg) {
        this._driver = driver;
        this._stlink = stlink;
        this._dbg = dbg;
        this._page_size = 2048;
        // _single_bank flag is set in init() if needed
    }

    async init() {
        // Read device ID and adjust page size for STM32L4R devices
        let dev_id = (await this._stlink.get_debugreg32(0xE0042000)) & 0xfff;
        if (dev_id === 0x470) {
            let optr = await this._stlink.get_debugreg32(FLASH_OPTR_REG);
            if (!(optr & FLASH_OPTR_DBANK_BIT)) {
                this._dbg.info('STM32L4[R|S] in single bank configuration');
                this._page_size *= 4;
                this._single_bank = true;
            } else {
                this._dbg.info('STM32L4[R|S] in dual bank configuration');
                this._page_size *= 2;
            }
        }
        await this.unlock();
    }

    async clear_sr() {
        // Clear any error flags in the status register.
        let sr = await this._stlink.get_debugreg32(FLASH_SR_REG);
        await this._stlink.set_debugreg32(FLASH_SR_REG, sr);
    }

    async unlock() {
        this._dbg.debug('unlock start');
        await this._driver.core_reset_halt();
        await this.clear_sr();
        // Lock first. Double unlock results in error!
        await this._stlink.set_debugreg32(FLASH_CR_REG, FLASH_CR_LOCK_BIT);

        await async_sleep(0.1);
        let cr = await this._stlink.get_debugreg32(FLASH_CR_REG);

        if (cr & FLASH_CR_LOCK_BIT) {
            // Unlock keys
            await this._stlink.set_debugreg32(FLASH_KEYR_REG, 0x45670123);
            await this._stlink.set_debugreg32(FLASH_KEYR_REG, 0xcdef89ab);
            cr = await this._stlink.get_debugreg32(FLASH_CR_REG);
        } else {
            throw new Exception(`Unexpected unlock behaviour! FLASH_CR ${H32(cr)}`);
        }
        // Check if programming was unlocked
        if (cr & FLASH_CR_LOCK_BIT) {
            throw new Exception(`Error unlocking FLASH_CR: ${H32(cr)}. Reset!`);
        }
        if (!(cr & FLASH_CR_OPTLOCK_BIT)) {
            throw new Exception(`Error unlocking FLASH_CR: ${H32(cr)}. Reset!`);
        }
    }

    async lock() {
        await this._stlink.set_debugreg32(FLASH_CR_REG, FLASH_CR_LOCK_BIT);
        let cr = await this._stlink.get_debugreg32(FLASH_CR_REG);
        this._dbg.debug(`lock cr ${H32(cr)}`);
    }

    async erase_all() {
        this._dbg.debug('erase_all');
        let cr = FLASH_CR_MER1_BIT | FLASH_CR_MER2_BIT;
        await this._stlink.set_debugreg32(FLASH_CR_REG, cr);
        await this._stlink.set_debugreg32(FLASH_CR_REG, cr | FLASH_CR_STRT_BIT);
        // Maximum ~22.1 sec on STM32L4R (two banks)
        await this.wait_busy(25, 'Erasing FLASH');
    }

    async erase_page(page) {
        this._dbg.debug(`erase_page ${page}`);
        await this.clear_sr();
        let flash_cr_value = FLASH_CR_PER_BIT | (page << FLASH_CR_PNB_BITINDEX);
        await this._stlink.set_debugreg32(FLASH_CR_REG, flash_cr_value);
        await this._stlink.set_debugreg32(FLASH_CR_REG, flash_cr_value | FLASH_CR_STRT_BIT);
        await this.wait_busy(0.05);
    }

    async erase_bank(bank) {
        this._dbg.debug(`erase_bank ${bank}`);
        await this.clear_sr();
        let cr = FLASH_CR_MER1_BIT;
        if (bank === 1) {
            cr = FLASH_CR_MER2_BIT;
        }
        await this._stlink.set_debugreg32(FLASH_CR_REG, cr);
        await this._stlink.set_debugreg32(FLASH_CR_REG, cr | FLASH_CR_STRT_BIT);
        await this.wait_busy(0.05);
    }

    async erase_pages(addr, size) {
        this._dbg.verbose(`erase_pages from addr ${addr.toString(16)} for ${size} bytes`);
        let page = Math.floor((addr - this._driver.FLASH_START) / this._page_size);
        let last_page = Math.floor((addr - this._driver.FLASH_START + size + this._page_size - 1) / this._page_size);
        this._dbg.verbose(`erase_pages ${page} to ${last_page}`);
        this._dbg.bargraph_start('Erasing FLASH', { value_min: page, value_max: last_page });
        if (page === 0 && last_page >= 256) {
            await this.erase_bank(0);
            page = 256;
            this._dbg.bargraph_update({ value: page });
        }
        while (page < last_page) {
            if (page === 256 && last_page >= 512) {
                await this.erase_bank(1);
                page = 512;
                this._dbg.bargraph_update({ value: page });
                break;
            }
            await this.erase_page(page);
            page++;
            this._dbg.bargraph_update({ value: page });
        }
        this._dbg.bargraph_done();
        await this._stlink.set_debugreg32(FLASH_CR_REG, 0);
    }

    async wait_busy(wait_time, bargraph_msg = null, check_eop = false) {
        const end_time = Date.now() + wait_time * 1.5 * 1000;
        if (bargraph_msg) {
            this._dbg.bargraph_start(bargraph_msg, {
                value_min: Date.now() / 1000,
                value_max: Date.now() / 1000 + wait_time,
            });
        }
        while (Date.now() < end_time) {
            if (bargraph_msg) {
                this._dbg.bargraph_update({ value: Date.now() / 1000 });
            }
            let status = await this._stlink.get_debugreg32(FLASH_SR_REG);
            let checkMask = FLASH_SR_BUSY_BIT | FLASH_SR_CFGBSY_BIT | (check_eop ? FLASH_SR_EOP_BIT : 0);
            if (!(status & checkMask)) {
                this.end_of_operation(status);
                if (bargraph_msg) {
                    this._dbg.bargraph_done();
                }
                return;
            }
            await async_sleep(wait_time / 20);
        }
        throw new Exception('Operation timeout');
    }

    end_of_operation(status) {
        if (status & FLASH_SR_ERROR_MASK) {
            throw new Exception(`Error writing FLASH with status (FLASH_SR) ${H32(status)}`);
        }
    }
}

class Stm32L4 extends Stm32 {
    async flash_erase_all(flash_size) {
        this._dbg.debug('Stm32L4.flash_erase_all()');
        let flash = new Flash(this, this._stlink, this._dbg);
        await flash.init();
        await flash.erase_all();
        await flash.lock();
    }

    async flash_write(addr, data, { erase = false, erase_sizes = null } = {}) {
        if (addr === null) {
            addr = this.FLASH_START;
        }
        this._dbg.debug(`Stm32L4.flash_write(${addr}, [data:${data.length}Bytes], erase=${erase}, erase_sizes=${erase_sizes})`);
        if (addr % 8 !== 0) {
            throw new Exception('Start address is not aligned to word');
        }
        // Pad data if needed so that its length is a multiple of 8.
        if (data.length % 8) {
            let padded_data = new Uint8Array(data.length + (8 - (data.length % 8)));
            padded_data.set(data);
            padded_data.fill(0xff, data.length);
            data = padded_data;
        }
        let flash = new Flash(this, this._stlink, this._dbg);
        await flash.unlock();
        if (erase) {
            if (erase_sizes) {
                await flash.erase_pages(addr, data.length);
            } else {
                await flash.erase_all();
            }
            await flash.unlock();
        }
        this._dbg.bargraph_start('Writing FLASH', { value_min: addr, value_max: addr + data.length });
        await this._stlink.set_debugreg32(FLASH_CR_REG, 0);
        await this._stlink.set_debugreg32(FLASH_CR_REG, FLASH_CR_PG_BIT);
        let cr = await this._stlink.get_debugreg32(FLASH_CR_REG);
        if (!(cr & FLASH_CR_PG_BIT)) {
            throw new Exception(`Flash_Cr not ready for programming: ${H32(cr)}`);
        }
        while (data.length) {
            let block = data.slice(0, 256);
            data = data.slice(256);
            this._dbg.debug(`Stm32L4.flash_write len ${block.length} addr ${addr.toString(16)}`);
            if (Math.min(...block) !== 0xff) {
                await this._stlink.set_mem32(addr, block);
            }
            addr += block.length;
            this._dbg.bargraph_update({ value: addr });
        }
        await flash.wait_busy(0.001);
        this._dbg.bargraph_done();
        await flash.lock();
    }

    async set_rdp(level) {

        let flash = new Flash(this, this._stlink, this._dbg);
        await flash.init();
        await flash.unlock();

        await this._stlink.set_debugreg32(FLASH_OPTKEYR_REG, 0x08192a3b);
        await this._stlink.set_debugreg32(FLASH_OPTKEYR_REG, 0x4c5d6e7f);

        let optr = await this._stlink.get_debugreg32(FLASH_OPTR_REG);

        if ((optr & 0xFF) === level) {
            this._dbg.debug("RDP already at correct level");
            return;
        }

        optr = (optr & ~0xFF) | level;
        await this._stlink.set_debugreg32(FLASH_OPTR_REG, optr);

        await this._stlink.set_debugreg32(FLASH_CR_REG, FLASH_CR_OPT_STRT_BIT);
        await flash.wait_busy(1);
        await this._stlink.set_debugreg32(FLASH_CR_REG, FLASH_CR_OBL_LAUNCH_BIT);
        await flash.lock();
    }
}

export { Stm32L4 };
