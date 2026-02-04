# GetAutomationLogs200Response

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Items** | [**[]GetAutomationLogs200ResponseItemsInner**](GetAutomationLogs200ResponseItemsInner.md) |  | 
**Meta** | [**ListInstances200ResponseMeta**](ListInstances200ResponseMeta.md) |  | 

## Methods

### NewGetAutomationLogs200Response

`func NewGetAutomationLogs200Response(items []GetAutomationLogs200ResponseItemsInner, meta ListInstances200ResponseMeta, ) *GetAutomationLogs200Response`

NewGetAutomationLogs200Response instantiates a new GetAutomationLogs200Response object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetAutomationLogs200ResponseWithDefaults

`func NewGetAutomationLogs200ResponseWithDefaults() *GetAutomationLogs200Response`

NewGetAutomationLogs200ResponseWithDefaults instantiates a new GetAutomationLogs200Response object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetItems

`func (o *GetAutomationLogs200Response) GetItems() []GetAutomationLogs200ResponseItemsInner`

GetItems returns the Items field if non-nil, zero value otherwise.

### GetItemsOk

`func (o *GetAutomationLogs200Response) GetItemsOk() (*[]GetAutomationLogs200ResponseItemsInner, bool)`

GetItemsOk returns a tuple with the Items field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetItems

`func (o *GetAutomationLogs200Response) SetItems(v []GetAutomationLogs200ResponseItemsInner)`

SetItems sets Items field to given value.


### GetMeta

`func (o *GetAutomationLogs200Response) GetMeta() ListInstances200ResponseMeta`

GetMeta returns the Meta field if non-nil, zero value otherwise.

### GetMetaOk

`func (o *GetAutomationLogs200Response) GetMetaOk() (*ListInstances200ResponseMeta, bool)`

GetMetaOk returns a tuple with the Meta field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMeta

`func (o *GetAutomationLogs200Response) SetMeta(v ListInstances200ResponseMeta)`

SetMeta sets Meta field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


