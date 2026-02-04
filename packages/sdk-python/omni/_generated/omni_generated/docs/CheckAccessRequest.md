# CheckAccessRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**instance_id** | **UUID** | Instance ID | 
**platform_user_id** | **str** | Platform user ID | 
**channel** | **str** | Channel type | 

## Example

```python
from omni_generated.models.check_access_request import CheckAccessRequest

# TODO update the JSON string below
json = "{}"
# create an instance of CheckAccessRequest from a JSON string
check_access_request_instance = CheckAccessRequest.from_json(json)
# print the JSON string representation of the object
print(CheckAccessRequest.to_json())

# convert the object into a dict
check_access_request_dict = check_access_request_instance.to_dict()
# create an instance of CheckAccessRequest from a dict
check_access_request_from_dict = CheckAccessRequest.from_dict(check_access_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


