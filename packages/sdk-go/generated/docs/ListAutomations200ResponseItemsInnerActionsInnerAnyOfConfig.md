# ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Url** | **string** | Webhook URL | 
**Method** | Pointer to **string** |  | [optional] [default to "POST"]
**Headers** | Pointer to **map[string]string** |  | [optional] 
**BodyTemplate** | Pointer to **string** |  | [optional] 
**WaitForResponse** | Pointer to **bool** |  | [optional] [default to false]
**TimeoutMs** | Pointer to **int32** |  | [optional] [default to 30000]
**ResponseAs** | Pointer to **string** |  | [optional] 

## Methods

### NewListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig

`func NewListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig(url string, ) *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig`

NewListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig instantiates a new ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewListAutomations200ResponseItemsInnerActionsInnerAnyOfConfigWithDefaults

`func NewListAutomations200ResponseItemsInnerActionsInnerAnyOfConfigWithDefaults() *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig`

NewListAutomations200ResponseItemsInnerActionsInnerAnyOfConfigWithDefaults instantiates a new ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetUrl

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig) GetUrl() string`

GetUrl returns the Url field if non-nil, zero value otherwise.

### GetUrlOk

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig) GetUrlOk() (*string, bool)`

GetUrlOk returns a tuple with the Url field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetUrl

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig) SetUrl(v string)`

SetUrl sets Url field to given value.


### GetMethod

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig) GetMethod() string`

GetMethod returns the Method field if non-nil, zero value otherwise.

### GetMethodOk

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig) GetMethodOk() (*string, bool)`

GetMethodOk returns a tuple with the Method field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMethod

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig) SetMethod(v string)`

SetMethod sets Method field to given value.

### HasMethod

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig) HasMethod() bool`

HasMethod returns a boolean if a field has been set.

### GetHeaders

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig) GetHeaders() map[string]string`

GetHeaders returns the Headers field if non-nil, zero value otherwise.

### GetHeadersOk

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig) GetHeadersOk() (*map[string]string, bool)`

GetHeadersOk returns a tuple with the Headers field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetHeaders

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig) SetHeaders(v map[string]string)`

SetHeaders sets Headers field to given value.

### HasHeaders

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig) HasHeaders() bool`

HasHeaders returns a boolean if a field has been set.

### GetBodyTemplate

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig) GetBodyTemplate() string`

GetBodyTemplate returns the BodyTemplate field if non-nil, zero value otherwise.

### GetBodyTemplateOk

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig) GetBodyTemplateOk() (*string, bool)`

GetBodyTemplateOk returns a tuple with the BodyTemplate field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetBodyTemplate

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig) SetBodyTemplate(v string)`

SetBodyTemplate sets BodyTemplate field to given value.

### HasBodyTemplate

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig) HasBodyTemplate() bool`

HasBodyTemplate returns a boolean if a field has been set.

### GetWaitForResponse

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig) GetWaitForResponse() bool`

GetWaitForResponse returns the WaitForResponse field if non-nil, zero value otherwise.

### GetWaitForResponseOk

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig) GetWaitForResponseOk() (*bool, bool)`

GetWaitForResponseOk returns a tuple with the WaitForResponse field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetWaitForResponse

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig) SetWaitForResponse(v bool)`

SetWaitForResponse sets WaitForResponse field to given value.

### HasWaitForResponse

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig) HasWaitForResponse() bool`

HasWaitForResponse returns a boolean if a field has been set.

### GetTimeoutMs

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig) GetTimeoutMs() int32`

GetTimeoutMs returns the TimeoutMs field if non-nil, zero value otherwise.

### GetTimeoutMsOk

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig) GetTimeoutMsOk() (*int32, bool)`

GetTimeoutMsOk returns a tuple with the TimeoutMs field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTimeoutMs

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig) SetTimeoutMs(v int32)`

SetTimeoutMs sets TimeoutMs field to given value.

### HasTimeoutMs

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig) HasTimeoutMs() bool`

HasTimeoutMs returns a boolean if a field has been set.

### GetResponseAs

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig) GetResponseAs() string`

GetResponseAs returns the ResponseAs field if non-nil, zero value otherwise.

### GetResponseAsOk

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig) GetResponseAsOk() (*string, bool)`

GetResponseAsOk returns a tuple with the ResponseAs field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetResponseAs

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig) SetResponseAs(v string)`

SetResponseAs sets ResponseAs field to given value.

### HasResponseAs

`func (o *ListAutomations200ResponseItemsInnerActionsInnerAnyOfConfig) HasResponseAs() bool`

HasResponseAs returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


