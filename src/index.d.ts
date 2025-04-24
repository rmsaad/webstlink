
export class WebStlink {
    constructor(dbg?: any, hard?: boolean);
    add_callback(name: 'inspect' | 'halted' | 'resumed', handler: (...args: any[]) => void): void;
    attach(device: any, device_dbg?: any): Promise<void>;
    detach(): Promise<void>;
    readonly connected: boolean;
    readonly examined: boolean;
    detect_cpu(expected_cpus: string[], pick_cpu?: (mcus: any[]) => Promise<string>): Promise<{
        part_no: number;
        core: string;
        dev_id: number;
        type: string;
        flash_size: number;
        sram_size: number;
        flash_start: number;
        sram_start: number;
        eeprom_size: number;
        freq: number;
    }>;
    inspect_cpu(): Promise<{ halted: boolean; debug: boolean }>;
    readonly last_cpu_status: { halted: boolean; debug: boolean } | null;
    set_debug_enable(enabled: boolean): Promise<void>;
    step(): Promise<void>;
    halt(): Promise<void>;
    run(): Promise<void>;
    reset(halt: boolean): Promise<void>;
    read_registers(): Promise<Record<string, number>>;
    read_register(name: string): Promise<number>;
    read_instruction(pc?: number): Promise<number>;
    read_memory(addr: number, size: number): Promise<ArrayBuffer>;
    flash(addr: number, data: ArrayBuffer | Uint8Array | number[]): Promise<void>;
    handle_semihosting(syscall_handler: (operation: any) => number): Promise<boolean>;
    set_rdp(level: number): Promise<void>;
}

export namespace libstlink {
    namespace usb {
        class Connector {
            constructor(dev: any, dbg?: any);
            connect(): Promise<void>;
            disconnect(): Promise<void>;
            readonly version: string;
            readonly xfer_counter: number;
            xfer(cmd: any, options?: { data?: any; rx_len?: number; retry?: number }): Promise<any>;
        }
        const filters: { vendorId: number; productId: number }[];
    }

    namespace exceptions {
        class Exception extends Error {}
        class Warning extends Error {}
        class UsbError extends Error {
            constructor(message: any, address: number, fatal?: boolean);
            readonly address: number;
            readonly fatal: boolean;
        }
    }

    class Stlinkv2 {
        constructor(connector: usb.Connector, dbg: any);
        init(swd_frequency?: number): Promise<void>;
        clean_exit(): Promise<void>;
        readonly ver_stlink: number;
        readonly ver_jtag: number;
        readonly ver_mass: number | null;
        readonly ver_swim: number | null;
        readonly ver_api: number;
        readonly ver_str: string;
        readonly target_voltage: number | null;
        readonly coreid: number;
        set_debugreg32(addr: number, data: number): Promise<void>;
        get_debugreg32(addr: number): Promise<number>;
        get_debugreg16(addr: number): Promise<number>;
        get_debugreg8(addr: number): Promise<number>;
        get_reg(reg: number): Promise<number>;
        set_reg(reg: number, data: number): Promise<void>;
        get_mem32(addr: number, size: number): Promise<DataView>;
        set_mem32(addr: number, data: Uint8Array): Promise<void>;
        get_mem8(addr: number, size: number): Promise<DataView>;
        set_mem8(addr: number, data: Uint8Array): Promise<void>;
        set_nrst(action: number): void;
    }

    const DEVICES: any[];

    namespace semihosting {
        const opcodes: Record<string, number>;
    }

    namespace drivers {
        class Stm32 {
            constructor(stlink: Stlinkv2, dbg: any);
            core_status(): Promise<number>;
            core_halt(): Promise<void>;
            core_run(): Promise<void>;
            core_step(): Promise<void>;
            core_reset(): Promise<void>;
            core_reset_halt(): Promise<void>;
            get_mem(addr: number, size: number): Promise<ArrayBuffer>;
            flash_write(addr: number, data: Uint8Array, options: any): Promise<void>;
            set_rdp(level: number): Promise<void>;
        }
        class Stm32FP extends Stm32 {}
        class Stm32FPXL extends Stm32 {}
        class Stm32FS extends Stm32 {}
        class Stm32L4 extends Stm32 {}
    }

    class Logger {
        constructor(verbose: number, log?: HTMLElement | null);
        debug(msg: string, level?: number): void;
        verbose(msg: string, level?: number): void;
        info(msg: string, level?: number): void;
        message(msg: string, level?: number): void;
        error(msg: string, level?: number): void;
        warning(msg: string, level?: number): void;
        bargraph_start(msg: string, value_min?: number, value_max?: number, level?: number): void;
        bargraph_update(value?: number, percent?: number | null): void;
        bargraph_done(): void;
        set_verbose(verbose: number): void;
        clear(): void;
    }
}
