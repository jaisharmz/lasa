import Foundation
import Security

struct Account: Codable, Equatable {
    var uid: String
    var handle: String
    var email: String?
    var project: String?
    var refreshToken: String
}

// The sign-in lives in the login keychain, never in a file. The sync engine gets it on stdin for each run.
enum Keychain {
    static let service = "Läsa"

    private static func match(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    static func load(_ account: String) -> Account? {
        var query = match(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(Account.self, from: data)
    }

    static func save(_ value: Account, as account: String) throws {
        let data = try JSONEncoder().encode(value)
        let status = SecItemUpdate(match(account) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = match(account)
            item[kSecValueData as String] = data
            item[kSecAttrLabel as String] = "Läsa sign-in"
            item[kSecAttrDescription as String] = "Läsa for Mac"
            let added = SecItemAdd(item as CFDictionary, nil)
            if added != errSecSuccess { throw KeychainError(status: added) }
        } else if status != errSecSuccess {
            throw KeychainError(status: status)
        }
    }

    static func delete(_ account: String) {
        SecItemDelete(match(account) as CFDictionary)
    }
}

struct KeychainError: LocalizedError {
    let status: OSStatus
    var errorDescription: String? { (SecCopyErrorMessageString(status, nil) as String?) ?? "Keychain error \(status)" }
}
