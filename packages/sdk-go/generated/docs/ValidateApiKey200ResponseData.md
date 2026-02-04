# ValidateApiKey200ResponseData

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Valid** | **bool** | Whether the API key is valid | 
**KeyPrefix** | **string** | Truncated key prefix for identification | 
**KeyName** | **string** | Key name (primary or custom name) | 
**Scopes** | **[]string** | Scopes granted to this key | 

## Methods

### NewValidateApiKey200ResponseData

`func NewValidateApiKey200ResponseData(valid bool, keyPrefix string, keyName string, scopes []string, ) *ValidateApiKey200ResponseData`

NewValidateApiKey200ResponseData instantiates a new ValidateApiKey200ResponseData object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewValidateApiKey200ResponseDataWithDefaults

`func NewValidateApiKey200ResponseDataWithDefaults() *ValidateApiKey200ResponseData`

NewValidateApiKey200ResponseDataWithDefaults instantiates a new ValidateApiKey200ResponseData object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetValid

`func (o *ValidateApiKey200ResponseData) GetValid() bool`

GetValid returns the Valid field if non-nil, zero value otherwise.

### GetValidOk

`func (o *ValidateApiKey200ResponseData) GetValidOk() (*bool, bool)`

GetValidOk returns a tuple with the Valid field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetValid

`func (o *ValidateApiKey200ResponseData) SetValid(v bool)`

SetValid sets Valid field to given value.


### GetKeyPrefix

`func (o *ValidateApiKey200ResponseData) GetKeyPrefix() string`

GetKeyPrefix returns the KeyPrefix field if non-nil, zero value otherwise.

### GetKeyPrefixOk

`func (o *ValidateApiKey200ResponseData) GetKeyPrefixOk() (*string, bool)`

GetKeyPrefixOk returns a tuple with the KeyPrefix field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetKeyPrefix

`func (o *ValidateApiKey200ResponseData) SetKeyPrefix(v string)`

SetKeyPrefix sets KeyPrefix field to given value.


### GetKeyName

`func (o *ValidateApiKey200ResponseData) GetKeyName() string`

GetKeyName returns the KeyName field if non-nil, zero value otherwise.

### GetKeyNameOk

`func (o *ValidateApiKey200ResponseData) GetKeyNameOk() (*string, bool)`

GetKeyNameOk returns a tuple with the KeyName field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetKeyName

`func (o *ValidateApiKey200ResponseData) SetKeyName(v string)`

SetKeyName sets KeyName field to given value.


### GetScopes

`func (o *ValidateApiKey200ResponseData) GetScopes() []string`

GetScopes returns the Scopes field if non-nil, zero value otherwise.

### GetScopesOk

`func (o *ValidateApiKey200ResponseData) GetScopesOk() (*[]string, bool)`

GetScopesOk returns a tuple with the Scopes field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetScopes

`func (o *ValidateApiKey200ResponseData) SetScopes(v []string)`

SetScopes sets Scopes field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


