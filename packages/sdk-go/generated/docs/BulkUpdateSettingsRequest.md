# BulkUpdateSettingsRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Settings** | **map[string]interface{}** | Key-value pairs | 
**Reason** | Pointer to **string** | Reason for changes (audit) | [optional] 

## Methods

### NewBulkUpdateSettingsRequest

`func NewBulkUpdateSettingsRequest(settings map[string]interface{}, ) *BulkUpdateSettingsRequest`

NewBulkUpdateSettingsRequest instantiates a new BulkUpdateSettingsRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewBulkUpdateSettingsRequestWithDefaults

`func NewBulkUpdateSettingsRequestWithDefaults() *BulkUpdateSettingsRequest`

NewBulkUpdateSettingsRequestWithDefaults instantiates a new BulkUpdateSettingsRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetSettings

`func (o *BulkUpdateSettingsRequest) GetSettings() map[string]interface{}`

GetSettings returns the Settings field if non-nil, zero value otherwise.

### GetSettingsOk

`func (o *BulkUpdateSettingsRequest) GetSettingsOk() (*map[string]interface{}, bool)`

GetSettingsOk returns a tuple with the Settings field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSettings

`func (o *BulkUpdateSettingsRequest) SetSettings(v map[string]interface{})`

SetSettings sets Settings field to given value.


### GetReason

`func (o *BulkUpdateSettingsRequest) GetReason() string`

GetReason returns the Reason field if non-nil, zero value otherwise.

### GetReasonOk

`func (o *BulkUpdateSettingsRequest) GetReasonOk() (*string, bool)`

GetReasonOk returns a tuple with the Reason field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetReason

`func (o *BulkUpdateSettingsRequest) SetReason(v string)`

SetReason sets Reason field to given value.

### HasReason

`func (o *BulkUpdateSettingsRequest) HasReason() bool`

HasReason returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


