# CreateWebhookSourceRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Name** | **string** | Unique source name | 
**Description** | Pointer to **string** | Description | [optional] 
**ExpectedHeaders** | Pointer to **map[string]bool** | Headers to validate | [optional] 
**Enabled** | Pointer to **bool** | Whether enabled | [optional] [default to true]

## Methods

### NewCreateWebhookSourceRequest

`func NewCreateWebhookSourceRequest(name string, ) *CreateWebhookSourceRequest`

NewCreateWebhookSourceRequest instantiates a new CreateWebhookSourceRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewCreateWebhookSourceRequestWithDefaults

`func NewCreateWebhookSourceRequestWithDefaults() *CreateWebhookSourceRequest`

NewCreateWebhookSourceRequestWithDefaults instantiates a new CreateWebhookSourceRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetName

`func (o *CreateWebhookSourceRequest) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *CreateWebhookSourceRequest) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *CreateWebhookSourceRequest) SetName(v string)`

SetName sets Name field to given value.


### GetDescription

`func (o *CreateWebhookSourceRequest) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *CreateWebhookSourceRequest) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *CreateWebhookSourceRequest) SetDescription(v string)`

SetDescription sets Description field to given value.

### HasDescription

`func (o *CreateWebhookSourceRequest) HasDescription() bool`

HasDescription returns a boolean if a field has been set.

### GetExpectedHeaders

`func (o *CreateWebhookSourceRequest) GetExpectedHeaders() map[string]bool`

GetExpectedHeaders returns the ExpectedHeaders field if non-nil, zero value otherwise.

### GetExpectedHeadersOk

`func (o *CreateWebhookSourceRequest) GetExpectedHeadersOk() (*map[string]bool, bool)`

GetExpectedHeadersOk returns a tuple with the ExpectedHeaders field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetExpectedHeaders

`func (o *CreateWebhookSourceRequest) SetExpectedHeaders(v map[string]bool)`

SetExpectedHeaders sets ExpectedHeaders field to given value.

### HasExpectedHeaders

`func (o *CreateWebhookSourceRequest) HasExpectedHeaders() bool`

HasExpectedHeaders returns a boolean if a field has been set.

### GetEnabled

`func (o *CreateWebhookSourceRequest) GetEnabled() bool`

GetEnabled returns the Enabled field if non-nil, zero value otherwise.

### GetEnabledOk

`func (o *CreateWebhookSourceRequest) GetEnabledOk() (*bool, bool)`

GetEnabledOk returns a tuple with the Enabled field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEnabled

`func (o *CreateWebhookSourceRequest) SetEnabled(v bool)`

SetEnabled sets Enabled field to given value.

### HasEnabled

`func (o *CreateWebhookSourceRequest) HasEnabled() bool`

HasEnabled returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


