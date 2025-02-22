// NOTE: We must not cache references to membersService.api
// as it is a getter and may change during runtime.
const Promise = require('bluebird');
const membersService = require('../../services/members');
const common = require('../../lib/common');
const fsLib = require('../../lib/fs');

const members = {
    docName: 'members',
    browse: {
        options: [
            'limit',
            'fields',
            'filter',
            'order',
            'debug',
            'page'
        ],
        permissions: true,
        validation: {},
        query(frame) {
            return membersService.api.members.list(frame.options);
        }
    },

    read: {
        headers: {},
        data: [
            'id',
            'email'
        ],
        validation: {},
        permissions: true,
        async query(frame) {
            const member = await membersService.api.members.get(frame.data, frame.options);
            if (!member) {
                throw new common.errors.NotFoundError({
                    message: common.i18n.t('errors.api.members.memberNotFound')
                });
            }
            return member;
        }
    },

    add: {
        statusCode: 201,
        headers: {},
        options: [
            'send_email',
            'email_type'
        ],
        validation: {
            data: {
                email: {required: true}
            },
            options: {
                email_type: {
                    values: ['signin', 'signup', 'subscribe']
                }
            }
        },
        permissions: true,
        query(frame) {
            // NOTE: Promise.resolve() is here for a reason! Method has to return an instance
            //      of a Bluebird promise to allow reflection. If decided to be replaced
            //      with something else, e.g: async/await, CSV export function
            //      would need a deep rewrite (see failing tests if this line is removed)
            return Promise.resolve()
                .then(() => {
                    return membersService.api.members.create(frame.data.members[0], {
                        sendEmail: frame.options.send_email,
                        emailType: frame.options.email_type
                    });
                })
                .then((member) => {
                    if (member) {
                        return Promise.resolve(member);
                    }
                })
                .catch((error) => {
                    if (error.code && error.message.toLowerCase().indexOf('unique') !== -1) {
                        return Promise.reject(new common.errors.ValidationError({message: common.i18n.t('errors.api.members.memberAlreadyExists')}));
                    }

                    return Promise.reject(error);
                });
        }
    },

    edit: {
        statusCode: 200,
        headers: {},
        options: [
            'id'
        ],
        validation: {
            options: {
                id: {
                    required: true
                }
            }
        },
        permissions: true,
        async query(frame) {
            const member = await membersService.api.members.update(frame.data.members[0], frame.options);
            return member;
        }
    },

    destroy: {
        statusCode: 204,
        headers: {},
        options: [
            'id'
        ],
        validation: {
            options: {
                id: {
                    required: true
                }
            }
        },
        permissions: true,
        async query(frame) {
            frame.options.require = true;
            await membersService.api.members.destroy(frame.options);
            return null;
        }
    },

    exportCSV: {
        headers: {
            disposition: {
                type: 'csv',
                value() {
                    const datetime = (new Date()).toJSON().substring(0, 10);
                    return `members.${datetime}.csv`;
                }
            }
        },
        response: {
            format: 'plain'
        },
        permissions: {
            method: 'browse'
        },
        validation: {},
        query(frame) {
            return membersService.api.members.list(frame.options);
        }
    },

    importCSV: {
        statusCode: 201,
        permissions: {
            method: 'add'
        },
        async query(frame) {
            let filePath = frame.file.path,
                fulfilled = 0,
                invalid = 0,
                duplicates = 0;

            return fsLib.readCSV({
                path: filePath,
                columnsToExtract: [{name: 'email', lookup: /email/i}, {name: 'name', lookup: /name/i}]
            }).then((result) => {
                return Promise.all(result.map((entry) => {
                    const api = require('./index');

                    return api.members.add.query({
                        data: {
                            members: [{
                                email: entry.email,
                                name: entry.name
                            }]
                        },
                        options: {
                            context: frame.options.context,
                            options: {send_email: false}
                        }
                    }).reflect();
                })).each((inspection) => {
                    if (inspection.isFulfilled()) {
                        fulfilled = fulfilled + 1;
                    } else {
                        if (inspection.reason() instanceof common.errors.ValidationError) {
                            duplicates = duplicates + 1;
                        } else {
                            invalid = invalid + 1;
                        }
                    }
                });
            }).then(() => {
                return {
                    meta: {
                        stats: {
                            imported: fulfilled,
                            duplicates: duplicates,
                            invalid: invalid
                        }
                    }
                };
            });
        }
    }
};

module.exports = members;
