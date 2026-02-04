# CheckAccess200ResponseData


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**allowed** | **bool** | Whether access is allowed | 
**rule** | [**CheckAccess200ResponseDataRule**](CheckAccess200ResponseDataRule.md) |  | 
**reason** | **str** | Reason for decision | 

## Example

```python
from omni_generated.models.check_access200_response_data import CheckAccess200ResponseData

# TODO update the JSON string below
json = "{}"
# create an instance of CheckAccess200ResponseData from a JSON string
check_access200_response_data_instance = CheckAccess200ResponseData.from_json(json)
# print the JSON string representation of the object
print(CheckAccess200ResponseData.to_json())

# convert the object into a dict
check_access200_response_data_dict = check_access200_response_data_instance.to_dict()
# create an instance of CheckAccess200ResponseData from a dict
check_access200_response_data_from_dict = CheckAccess200ResponseData.from_dict(check_access200_response_data_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


